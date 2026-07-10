/**
 * Koyfin UI Translator — content script.
 *
 * Translates static UI strings on koyfin.com using an exact-match, offline
 * dictionary — but only inside whitelisted UI scopes (src/scopes.json):
 * navigation, tabs, table headers, buttons, dialogs, toolbar labels.
 * Everything else — data cells, tickers, company and fund names, news —
 * is structurally out of scope and can never be touched. Within a scope,
 * exact-match lookup is the second layer of protection: unknown strings
 * (e.g. user-named watchlists shown in the nav) stay as-is.
 *
 * Performance notes:
 * - Lookups are O(1) via a Map built from a single per-language JSON file.
 * - Only whitelisted subtrees are walked; large data regions are never
 *   traversed at all.
 * - DOM changes from the SPA are handled by a MutationObserver. Small
 *   batches are translated synchronously inside the observer callback — a
 *   microtask that runs BEFORE the next paint, so users never see an
 *   untranslated flash. Only oversized batches (bulk re-renders, mostly
 *   non-whitelisted data regions) spill over to requestIdleCallback
 *   slices, keeping the frame budget safe.
 * - Original strings are kept in WeakMaps so translations can be reverted
 *   (disable / language switch) without leaking memory on removed nodes.
 */

"use strict";

(() => {
  const SUPPORTED_LANGS = ["zh_CN", "zh_TW", "ja", "ko", "de", "fr", "es"];
  // Keep in sync with src/popup.js — translation is off until the user
  // enables it in the popup.
  const DEFAULTS = {
    enabled: false,
    lang: "zh_CN",
    dynamicEnabled: false,
    engine: "builtin", // "builtin" (Chrome on-device) | "google" (user's API key)
  };

  // Language codes per engine. The built-in Translator API takes BCP-47
  // tags; candidates are tried in order until one is available.
  const BUILTIN_LANG = {
    zh_CN: ["zh", "zh-Hans"], // Chrome's pack registry lists Simplified as "zh"
    zh_TW: ["zh-Hant", "zh-TW"],
    ja: ["ja"],
    ko: ["ko"],
    de: ["de"],
    fr: ["fr"],
    es: ["es"],
  };
  const GOOGLE_LANG = {
    zh_CN: "zh-CN",
    zh_TW: "zh-TW",
    ja: "ja",
    ko: "ko",
    de: "de",
    fr: "fr",
    es: "es",
  };
  // Bounds for machine-translated strings (dictionary handles the rest).
  const DYN_MIN_LEN = 4;
  const DYN_MAX_LEN = 3000;
  const DYN_BATCH_SIZE = 50;

  // Elements whose entire subtree must never be touched. SVG (charts) is
  // excluded via its namespace, and user-editable content via
  // isContentEditable — see isSkipped().
  const SKIP_SUBTREE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"]);
  // Elements whose text children hold user content, not UI labels.
  // Their attributes (e.g. placeholder) are still translated.
  const SKIP_TEXT_PARENT_TAGS = new Set(["TEXTAREA"]);
  const HTML_NS = "http://www.w3.org/1999/xhtml";

  // Translatable element attributes.
  const ATTRS = ["placeholder", "title", "aria-label"];

  // Max milliseconds of translation work per idle slice.
  const SLICE_BUDGET_MS = 8;
  // Max milliseconds of synchronous (pre-paint) translation per mutation
  // batch; anything beyond spills to the idle queue.
  const SYNC_BUDGET_MS = 6;

  /** @type {Map<string, string> | null} English -> translation */
  let dict = null;
  /** Combined CSS selectors from src/scopes.json. */
  let whitelistSel = null;
  let excludeSel = null;
  let dynamicSel = null; // "" when no dynamic scopes are defined
  let enabled = DEFAULTS.enabled;
  let lang = DEFAULTS.lang;
  let dynamicEnabled = DEFAULTS.dynamicEnabled;
  let engine = DEFAULTS.engine;

  /**
   * Per translated text node: { original, translated }. Storing what we
   * wrote lets us tell our own writes apart from app re-renders: if the
   * current value differs from `translated`, the app replaced the content
   * and the current value is the new source text — the cached original is
   * stale and must not be trusted (it would clobber the new content).
   */
  const textOriginals = new WeakMap();
  /** Per element: { [attr]: { original, translated } } — same idea. */
  const attrOriginals = new WeakMap();

  /** Nodes queued by the MutationObserver, awaiting an idle slice. */
  const pending = new Set();
  let scheduled = false;
  let observer = null;

  const scheduleIdle =
    typeof requestIdleCallback === "function"
      ? (cb) => requestIdleCallback(cb, { timeout: 1000 })
      : (cb) => setTimeout(() => cb({ timeRemaining: () => SLICE_BUDGET_MS }), 50);

  async function loadJson(path) {
    const res = await fetch(chrome.runtime.getURL(path));
    return res.json();
  }

  async function loadScopes() {
    if (whitelistSel !== null) return;
    const { whitelist, exclude, dynamic } = await loadJson("src/scopes.json");
    whitelistSel = whitelist.join(", ");
    excludeSel = exclude.join(", ");
    dynamicSel = (dynamic ?? []).join(", ");
  }

  async function loadDict(language) {
    return new Map(Object.entries(await loadJson(`locales/${language}.json`)));
  }

  function lookup(trimmed) {
    let t = dict.get(trimmed);
    if (t !== undefined) return t;
    // Handle labels rendered with a trailing colon, e.g. "Name:".
    if (trimmed.endsWith(":")) {
      t = dict.get(trimmed.slice(0, -1));
      if (t !== undefined) return t + ":";
    }
    return undefined;
  }

  function translateTextNode(node) {
    let rec = textOriginals.get(node);
    // Records with a `lang` field belong to the dynamic (machine) path.
    // The dictionary pass must not touch a live machine translation —
    // reverting it here would ping-pong with the dynamic path re-applying
    // it, an infinite mutation loop that freezes the page.
    if (rec !== undefined && rec.lang !== undefined) {
      if (node.nodeValue === rec.translated) return;
      // The app re-rendered over it: drop the stale record, treat as fresh.
      textOriginals.delete(node);
      rec = undefined;
    }
    const current = node.nodeValue;
    // Recover the source text: if the node still holds exactly what we
    // wrote, the recorded original is valid; otherwise the app re-rendered
    // and the current value IS the new source.
    const ownWrite = rec !== undefined && current === rec.translated;
    const original = ownWrite ? rec.original : current;
    if (!ownWrite && rec !== undefined) textOriginals.delete(node);
    if (!original) return;
    // Length cap matches the audit heuristic; long static feature blurbs
    // are legitimate dictionary entries.
    const trimmed = original.trim();
    if (!trimmed || trimmed.length > 300) return;
    const t = lookup(trimmed);
    if (t === undefined) {
      // Dictionary no longer matches (e.g. language switched): restore.
      if (ownWrite) {
        node.nodeValue = original;
        textOriginals.delete(node);
      }
      return;
    }
    const start = original.indexOf(trimmed[0]);
    const next = original.slice(0, start) + t + original.slice(start + trimmed.length);
    // Guard against no-op writes: they would re-trigger the observer.
    if (node.nodeValue !== next) node.nodeValue = next;
    textOriginals.set(node, { original, translated: next });
  }

  function translateElementAttrs(el) {
    let saved = attrOriginals.get(el);
    for (const attr of ATTRS) {
      const rec = saved?.[attr];
      const current = el.getAttribute(attr);
      const ownWrite = rec !== undefined && current === rec.translated;
      const original = ownWrite ? rec.original : current;
      if (!ownWrite && rec !== undefined) delete saved[attr];
      if (!original) continue;
      const t = lookup(original.trim());
      if (t === undefined) {
        if (ownWrite) {
          el.setAttribute(attr, original);
          delete saved[attr];
        }
        continue;
      }
      if (!saved) attrOriginals.set(el, (saved = {}));
      if (current !== t) el.setAttribute(attr, t);
      saved[attr] = { original, translated: t };
    }
  }

  function isSkipped(el) {
    return (
      el.namespaceURI !== HTML_NS || // SVG/MathML, e.g. chart internals
      SKIP_SUBTREE_TAGS.has(el.tagName) ||
      el.isContentEditable ||
      (excludeSel !== null && el.matches(excludeSel))
    );
  }

  function isTranslatableText(node) {
    const parent = node.parentElement;
    return parent && !isSkipped(parent) && !SKIP_TEXT_PARENT_TAGS.has(parent.tagName);
  }

  /**
   * Translate (or revert, when the dictionary no longer matches) a subtree
   * that is already known to be inside a whitelisted scope.
   */
  function processSubtree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (isTranslatableText(root)) translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || isSkipped(root)) return;
    translateElementAttrs(root);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return isSkipped(node)
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT;
          }
          return isTranslatableText(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateElementAttrs(node);
    }
  }

  /**
   * Entry point for any node: translate the parts of its subtree that fall
   * inside whitelisted scopes, and nothing else.
   */
  function translateWithinScopes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && parent.closest(whitelistSel)) processSubtree(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.closest(whitelistSel)) {
      // Inside a scope already: the whole subtree is fair game.
      processSubtree(node);
      return;
    }
    // Outside any scope: descend only into whitelisted subtrees.
    for (const el of node.querySelectorAll(whitelistSel)) processSubtree(el);
  }

  // ---- Dynamic (machine) translation ------------------------------------
  // Applies only inside `dynamic` scopes from scopes.json and only when the
  // user enabled it. Dictionary hits are applied for free; the rest goes to
  // the selected engine. Results are cached per language, and nodes carry
  // the same { original, translated } records as the static path, so
  // re-render protection, language switching, and revert all work the same.

  /** trimmed source -> translated text, valid for the current `lang`. */
  const dynCache = new Map();
  /** Text nodes with an in-flight request, to avoid duplicate work. */
  const dynInFlight = new WeakSet();
  /** Set when the engine fails: stops retry storms until settings change. */
  let dynamicBroken = false;
  let builtinTranslator = null;
  let builtinTranslatorLang = null;

  function isDynamicCandidate(trimmed) {
    return (
      trimmed.length >= DYN_MIN_LEN &&
      trimmed.length <= DYN_MAX_LEN &&
      /[A-Za-z]{2}/.test(trimmed) // skip numbers, tickers, symbols
    );
  }

  async function getBuiltinTranslator() {
    if (builtinTranslator && builtinTranslatorLang === lang) {
      return builtinTranslator;
    }
    if (typeof Translator === "undefined") {
      throw new Error("Chrome built-in Translator API is not available");
    }
    for (const target of BUILTIN_LANG[lang]) {
      const availability = await Translator.availability({
        sourceLanguage: "en",
        targetLanguage: target,
      });
      if (availability === "unavailable") continue;
      builtinTranslator = await Translator.create({
        sourceLanguage: "en",
        targetLanguage: target,
      });
      builtinTranslatorLang = lang;
      return builtinTranslator;
    }
    throw new Error(`no built-in language pair for ${lang}`);
  }

  async function builtinTranslate(texts) {
    const translator = await getBuiltinTranslator();
    const out = [];
    for (const text of texts) out.push(await translator.translate(text));
    return out;
  }

  function googleTranslate(texts) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "translateBatch", texts, target: GOOGLE_LANG[lang] },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!resp || resp.error) {
            reject(new Error(resp?.error ?? "no response"));
          } else {
            resolve(resp.translations);
          }
        }
      );
    });
  }

  function applyDynamic(node, original, trimmed, translated) {
    const start = original.indexOf(trimmed[0]);
    const next =
      original.slice(0, start) + translated + original.slice(start + trimmed.length);
    if (node.nodeValue !== next) node.nodeValue = next;
    textOriginals.set(node, { original, translated: next, lang });
  }

  /** Queue a text node for dynamic translation if it qualifies. */
  function considerDynamicText(node, out) {
    if (!isTranslatableText(node)) return;
    const rec = textOriginals.get(node);
    const current = node.nodeValue;
    const ownWrite = rec !== undefined && current === rec.translated;
    if (ownWrite && rec.lang === lang) return; // already done for this language
    const original = ownWrite ? rec.original : current;
    const trimmed = original.trim();
    if (!trimmed) return;
    // Dictionary first: exact, free, and consistent with the static layer.
    if (lookup(trimmed) !== undefined) {
      translateTextNode(node);
      return;
    }
    if (!isDynamicCandidate(trimmed)) return;
    const cached = dynCache.get(trimmed);
    if (cached !== undefined) {
      applyDynamic(node, original, trimmed, cached);
      return;
    }
    if (dynInFlight.has(node)) return;
    out.push({ node, original, trimmed });
  }

  function collectDynamicTexts(root, out) {
    if (root.nodeType === Node.TEXT_NODE) {
      considerDynamicText(root, out);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || isSkipped(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent && !isSkipped(parent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let node;
    while ((node = walker.nextNode())) considerDynamicText(node, out);
  }

  async function translateDynamicBatch(items) {
    const requestLang = lang;
    for (const { node } of items) dynInFlight.add(node);
    try {
      const texts = [...new Set(items.map((i) => i.trimmed))];
      for (let i = 0; i < texts.length; i += DYN_BATCH_SIZE) {
        const chunk = texts.slice(i, i + DYN_BATCH_SIZE);
        const translations =
          engine === "google"
            ? await googleTranslate(chunk)
            : await builtinTranslate(chunk);
        if (lang !== requestLang) return; // language switched mid-flight
        chunk.forEach((t, j) => dynCache.set(t, translations[j]));
      }
      for (const { node, original, trimmed } of items) {
        // Apply only if the node still shows what we sampled — anything
        // else means the app re-rendered while we were waiting.
        if (!node.isConnected || node.nodeValue !== original) continue;
        const translated = dynCache.get(trimmed);
        if (translated !== undefined) applyDynamic(node, original, trimmed, translated);
      }
    } catch (err) {
      // Circuit-break: without this, every subsequent DOM mutation would
      // retry the whole batch against a failing engine.
      dynamicBroken = true;
      console.warn(
        "[koyfin-i18n] dynamic translation disabled for this page after an engine error:",
        err
      );
    } finally {
      for (const { node } of items) dynInFlight.delete(node);
    }
  }

  /** Dynamic counterpart of translateWithinScopes. */
  function translateDynamicWithin(node) {
    const items = [];
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && parent.closest(dynamicSel)) considerDynamicText(node, items);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.closest(dynamicSel)) {
        collectDynamicTexts(node, items);
      } else {
        for (const el of node.querySelectorAll(dynamicSel)) {
          collectDynamicTexts(el, items);
        }
      }
    }
    if (items.length > 0) translateDynamicBatch(items);
  }

  /** Single entry point for any node: static scopes, then dynamic scopes. */
  function handleNode(node) {
    translateWithinScopes(node);
    if (dynamicEnabled && dynamicSel && !dynamicBroken) {
      translateDynamicWithin(node);
    }
  }

  function drainPending(deadline) {
    const start = performance.now();
    for (const node of pending) {
      pending.delete(node);
      if (node.isConnected) handleNode(node);
      const budgetUsed = performance.now() - start > SLICE_BUDGET_MS;
      if (budgetUsed && deadline.timeRemaining() <= 0) break;
    }
    if (pending.size > 0) {
      scheduleIdle(drainPending);
    } else {
      scheduled = false;
    }
  }

  function enqueue(node) {
    pending.add(node);
    if (!scheduled) {
      scheduled = true;
      scheduleIdle(drainPending);
    }
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      const batch = new Set();
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const node of m.addedNodes) batch.add(node);
        } else {
          batch.add(m.target); // characterData and attribute mutations
        }
      }
      // The observer callback is a microtask: it runs after the DOM change
      // but BEFORE the next paint. Translating here means the user never
      // sees the untranslated text. A time budget keeps huge batches from
      // blocking the frame — the remainder goes to the idle queue.
      const start = performance.now();
      for (const node of batch) {
        if (performance.now() - start > SYNC_BUDGET_MS) {
          enqueue(node);
          continue;
        }
        if (node.isConnected) handleNode(node);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pending.clear();
    scheduled = false;
  }

  /** Restore every translated node/attribute to its original English text. */
  function revertAll() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const rec = textOriginals.get(node);
        if (rec !== undefined) {
          // Restore only if the node still holds our translation; app
          // re-renders after the write must not be clobbered.
          if (node.nodeValue === rec.translated) node.nodeValue = rec.original;
          textOriginals.delete(node);
        }
      } else {
        const saved = attrOriginals.get(node);
        if (saved) {
          for (const [attr, rec] of Object.entries(saved)) {
            if (node.getAttribute(attr) === rec.translated) {
              node.setAttribute(attr, rec.original);
            }
          }
          attrOriginals.delete(node);
        }
      }
    }
  }

  let hasApplied = false;

  async function apply() {
    if (!enabled || !SUPPORTED_LANGS.includes(lang)) {
      stopObserver();
      dict = null;
      revertAll();
      hasApplied = false;
      return;
    }
    try {
      await loadScopes();
      dict = await loadDict(lang);
    } catch (err) {
      console.warn("[koyfin-i18n] failed to load dictionary/scopes:", err);
      return;
    }
    // On settings changes, start from a clean slate so disabled features
    // (e.g. dynamic translation switched off) actually revert.
    if (hasApplied) revertAll();
    hasApplied = true;
    dynamicBroken = false; // settings changed: give the engine another try
    handleNode(document.body);
    startObserver();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let changed = false;
    if (changes.enabled && typeof changes.enabled.newValue === "boolean") {
      enabled = changes.enabled.newValue;
      changed = true;
    }
    if (changes.lang && typeof changes.lang.newValue === "string") {
      lang = changes.lang.newValue;
      dynCache.clear(); // cached translations are per-language
      builtinTranslator = null;
      changed = true;
    }
    if (changes.dynamicEnabled && typeof changes.dynamicEnabled.newValue === "boolean") {
      dynamicEnabled = changes.dynamicEnabled.newValue;
      changed = true;
    }
    if (changes.engine && typeof changes.engine.newValue === "string") {
      engine = changes.engine.newValue;
      dynCache.clear();
      changed = true;
    }
    if (changes.engineNonce) {
      // Popup signal (e.g. a language pack finished downloading): retry the
      // engine — apply() resets the circuit breaker.
      builtinTranslator = null;
      changed = true;
    }
    if (changed) apply();
  });

  // Ground-truth status for the popup: availability() lies to origins that
  // never used the translator (anti-fingerprinting), but whether THIS page
  // holds a working translator instance is a fact.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "builtinStatus") return false;
    sendResponse({
      lang,
      active: builtinTranslator !== null && builtinTranslatorLang === lang,
      broken: dynamicBroken,
    });
    return false;
  });

  chrome.storage.sync.get(DEFAULTS, (items) => {
    enabled = items.enabled;
    lang = items.lang;
    dynamicEnabled = items.dynamicEnabled;
    engine = items.engine;
    if (document.body) {
      apply();
    } else {
      document.addEventListener("DOMContentLoaded", apply, { once: true });
    }
  });
})();
