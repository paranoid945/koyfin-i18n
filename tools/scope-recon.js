/**
 * Scope reconnaissance script — self-contained, no build step.
 *
 * Paste this whole file into the DevTools console on a koyfin.com page
 * (run it with the extension DISABLED so original English text is scanned).
 *
 * It walks the DOM and groups every piece of English-looking text by a
 * structural "scope signature" built from stable DOM features:
 *
 *   - data-testid / data-test / data-cy values
 *   - ARIA roles
 *   - semantic tags (nav, aside, table, th, button, ...)
 *   - class names without digits (CSS-in-JS hashes are dropped)
 *
 * Bare wrapper divs/spans are omitted so signatures stay short and survive
 * markup churn. The output is a per-scope report: how many strings, how
 * many unique, samples, and a best-effort CSS selector — so scopes can be
 * classified as UI (translate) or data (never touch) to build the
 * translation whitelist.
 *
 * The JSON report is downloaded as a file, copied to the clipboard, and
 * returned.
 */

(() => {
  "use strict";

  const SKIP_SUBTREE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"]);
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const ATTRS = ["placeholder", "title", "aria-label"];
  const TESTID_ATTRS = ["data-testid", "data-test", "data-cy"];
  // Tags meaningful enough to appear in a signature even without attributes.
  const SEMANTIC_TAGS = new Set([
    "nav", "aside", "header", "footer", "main", "section", "article",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "button", "a", "label", "form", "input", "select", "option",
    "ul", "ol", "li", "menu", "dialog", "h1", "h2", "h3", "h4", "h5", "h6",
  ]);
  const MAX_TOKENS = 8; // signature depth cap
  const PREVIEW_SAMPLES = 3; // texts shown per scope in the console table
  // The JSON report itself contains ALL unique texts per scope.

  function isSkipped(el) {
    return (
      el.namespaceURI !== HTML_NS ||
      SKIP_SUBTREE_TAGS.has(el.tagName) ||
      el.isContentEditable
    );
  }

  /** Any string containing letters; deliberately no length cap — long
   *  static UI copy (feature blurbs) must be inventoried too. */
  function isEnglishText(s) {
    return /[A-Za-z]/.test(s);
  }

  /**
   * Strip build-specific hash parts from a class name, keeping the stable
   * semantic prefix. Returns null when nothing stable remains.
   *   CSS Modules (Koyfin): base-container__main___eLLNG -> base-container__main
   *   styled-components:    MenuItem-sc-1a2b3c           -> MenuItem
   *   emotion:              css-9xkzb2                   -> (dropped)
   */
  function normalizeClass(c) {
    const cssModules = /^(.+?)___[A-Za-z0-9_-]+$/.exec(c);
    if (cssModules) c = cssModules[1];
    c = c.replace(/-sc-[A-Za-z0-9]+$/, "");
    if (!c || /^css-[a-z0-9]+$/i.test(c)) return null;
    if (/\d/.test(c) || c.length > 40) return null; // remaining hash-like
    return c;
  }

  function stableClasses(el) {
    const list = typeof el.className === "string" ? el.className.split(/\s+/) : [];
    return list.map(normalizeClass).filter(Boolean).slice(0, 2);
  }

  /**
   * Signature token for one element, or null if the element is an
   * anonymous wrapper that should not appear in signatures.
   */
  function token(el) {
    const tag = el.tagName.toLowerCase();
    const parts = [];
    for (const attr of TESTID_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) parts.push(`[${attr}=${v}]`);
    }
    const role = el.getAttribute("role");
    if (role) parts.push(`[role=${role}]`);
    if (parts.length > 0) return tag + parts.join("");
    const classes = stableClasses(el);
    if (classes.length > 0) return tag + "." + classes.join(".");
    if (SEMANTIC_TAGS.has(tag)) return tag;
    return null; // anonymous div/span wrapper
  }

  /**
   * Scope signature: significant ancestor tokens, outermost first.
   * Consecutive duplicates (e.g. recursive layout boxes nested N deep) are
   * collapsed so nesting depth doesn't split otherwise-identical scopes.
   */
  function signatureFor(el) {
    const tokens = [];
    for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
      const t = token(cur);
      if (t && tokens[0] !== t) tokens.unshift(t);
    }
    return tokens.slice(-MAX_TOKENS).join(" > ") || "(body)";
  }

  /** scope signature -> { count, texts: Map<text, count> } */
  const scopes = new Map();

  function record(el, rawText, source) {
    const text = rawText.trim();
    if (!text || !isEnglishText(text)) return;
    const sig = signatureFor(el) + (source === "text" ? "" : ` @${source}`);
    let entry = scopes.get(sig);
    if (!entry) scopes.set(sig, (entry = { count: 0, texts: new Map() }));
    entry.count += 1;
    entry.texts.set(text, (entry.texts.get(text) || 0) + 1);
  }

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return isSkipped(node)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement) record(node.parentElement, node.nodeValue, "text");
    } else {
      for (const attr of ATTRS) {
        const v = node.getAttribute(attr);
        if (v) record(node, v, attr);
      }
    }
  }

  /** Best-effort CSS selector from a signature (drops the @attr suffix). */
  function toSelector(sig) {
    if (sig === "(body)") return "body";
    return sig
      .replace(/ @.*$/, "")
      .split(" > ")
      .map((t) => t.replaceAll("=", '="').replaceAll("]", '"]'))
      .join(" ");
  }

  const report = {
    url: location.href,
    date: new Date().toISOString(),
    scopes: [...scopes.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([scope, { count, texts }]) => ({
        scope,
        selector: toSelector(scope),
        count,
        uniqueTexts: texts.size,
        texts: [...texts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([text, n]) => ({ text, count: n })),
      })),
  };

  console.log(
    `[koyfin-i18n recon] ${report.scopes.length} scopes, ` +
      `${report.scopes.reduce((s, x) => s + x.count, 0)} text occurrences.`
  );
  console.table(
    report.scopes.slice(0, 30).map(({ scope, count, uniqueTexts, texts }) => ({
      scope,
      count,
      uniqueTexts,
      sample: texts
        .slice(0, PREVIEW_SAMPLES)
        .map((t) => t.text)
        .join(" | "),
    }))
  );
  const json = JSON.stringify(report, null, 2);

  // Primary export: download the report as a file.
  try {
    const slug =
      location.pathname.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home";
    const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `koyfin-recon-${slug}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    console.log(`[koyfin-i18n recon] Report downloaded as ${a.download}`);
  } catch (err) {
    console.warn("[koyfin-i18n recon] Download failed:", err);
  }

  // Secondary export: DevTools clipboard helper.
  try {
    copy(json);
    console.log("[koyfin-i18n recon] Report also copied to clipboard.");
  } catch {
    // Not running in DevTools; the report object is still returned below.
  }
  return report;
})();
