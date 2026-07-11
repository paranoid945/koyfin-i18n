/**
 * Popup: reads and writes the shared settings in chrome.storage.sync.
 *
 * The popup UI itself is localized to the language the user selected for
 * page translation (src/popup-locales.json, English fallback). Chrome's
 * _locales mechanism is deliberately not used: it follows the browser UI
 * language and cannot switch at runtime.
 */

"use strict";

const DEFAULTS = { enabled: false, lang: "zh_CN", dynamicEnabled: false, engine: "builtin" };

// Built-in Translator target candidates per UI language (BCP-47),
// tried in order. Keep in sync with src/content.js.
const BUILTIN_LANG = {
  zh_CN: ["zh", "zh-Hans"], // Chrome's pack registry lists Simplified as "zh"
  zh_TW: ["zh-Hant", "zh-TW"],
  ja: ["ja"],
  ko: ["ko"],
  de: ["de"],
  fr: ["fr"],
  es: ["es"],
};

const enabledInput = document.getElementById("enabled");
const langSelect = document.getElementById("lang");
const dynamicInput = document.getElementById("dynamic");
const dynamicOptions = document.getElementById("dynamic-options");
const engineSelect = document.getElementById("engine");
const keyRow = document.getElementById("key-row");
const keyInput = document.getElementById("apikey");
const keyHelp = document.getElementById("key-help");
const keyStatus = document.getElementById("key-status");
const saveKeyBtn = document.getElementById("save-key");
const engineNote = document.getElementById("engine-note");
const statusRow = document.getElementById("builtin-status-row");
const statusEl = document.getElementById("builtin-status");
const downloadBtn = document.getElementById("download-pack");

// ---- Popup localization ------------------------------------------------

/** All popup strings, keyed by language; loaded once at startup. */
let STRINGS = { en: {} };
let uiLang = DEFAULTS.lang;

/** Translate a popup string key, with optional {placeholder} params. */
function t(key, params) {
  let s = STRINGS[uiLang]?.[key] ?? STRINGS.en[key] ?? key;
  for (const [name, value] of Object.entries(params ?? {})) {
    s = s.replaceAll(`{${name}}`, String(value));
  }
  return s;
}

/** Re-render every data-i18n annotated element for the current language. */
function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
}

// ---- Status helpers ----------------------------------------------------

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` status--${kind}` : ""}`;
}

function setKeyStatus(text, kind) {
  keyStatus.hidden = !text;
  keyStatus.textContent = text;
  keyStatus.className = `note status${kind ? ` status--${kind}` : ""}`;
}

// ---- Built-in engine status ---------------------------------------------

/** Target language chosen for a pending pack download. */
let downloadTarget = null;

/**
 * Ask the active tab's content script whether it holds a working translator
 * for `lang` — the only truthful signal. `Translator.availability()` from
 * this popup (a never-used origin) can report "downloadable" even when the
 * pack is installed, due to Chrome's anti-fingerprinting masking.
 */
async function queryPageStatus(lang) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "builtinStatus" });
    return resp && resp.lang === lang ? resp : null;
  } catch {
    return null; // not a Koyfin tab / content script not injected
  }
}

/**
 * Shows the built-in language pack state for the selected language, with an
 * Enable/Download button when needed (pack downloads need a user gesture,
 * which a popup click provides — content scripts often can't trigger them).
 */
async function refreshBuiltinStatus() {
  const show = dynamicInput.checked && engineSelect.value === "builtin";
  statusRow.hidden = !show;
  if (!show) return;
  downloadBtn.hidden = true;
  downloadTarget = null;
  if (typeof Translator === "undefined") {
    setStatus(t("statusNoApi"), "err");
    return;
  }
  setStatus(t("statusChecking"), "");
  const { lang } = await chrome.storage.sync.get({ lang: DEFAULTS.lang });

  // Ground truth first: is the translator actually running on the page?
  const page = await queryPageStatus(lang);
  if (page?.active) {
    setStatus(t("statusActive"), "ok");
    return;
  }
  const results = [];
  for (const target of BUILTIN_LANG[lang] ?? []) {
    results.push({
      target,
      availability: await Translator.availability({
        sourceLanguage: "en",
        targetLanguage: target,
      }),
    });
  }
  const ready = results.find((r) => r.availability === "available");
  const downloading = results.find((r) => r.availability === "downloading");
  const downloadable = results.find((r) => r.availability === "downloadable");
  // Diagnostic detail: exactly what the API said per language tag.
  const detail = results.map((r) => `${r.target}: ${r.availability}`).join(", ");
  if (ready) {
    setStatus(t("statusReady"), "ok");
  } else if (downloading) {
    setStatus(`${t("statusDownloading")} (${detail})`, "warn");
  } else if (downloadable) {
    // "downloadable" may just mean "installed but never used by this
    // extension" — clicking Enable is instant in that case.
    downloadTarget = downloadable.target;
    setStatus(t("statusNotInit"), "warn");
    downloadBtn.hidden = false;
  } else {
    setStatus(`${t("statusUnsupported")} (${detail})`, "err");
  }
}

downloadBtn.addEventListener("click", async () => {
  if (!downloadTarget) return;
  downloadBtn.hidden = true;
  try {
    await Translator.create({
      sourceLanguage: "en",
      targetLanguage: downloadTarget,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          setStatus(t("statusDlProgress", { pct: Math.round(e.loaded * 100) }), "warn");
        });
      },
    });
    setStatus(t("statusReady"), "ok");
    // Nudge content scripts to retry (resets their engine circuit breaker).
    chrome.storage.sync.set({ engineNonce: Date.now() });
  } catch (err) {
    setStatus(t("statusDlFailed", { err: err.message ?? err }), "err");
    downloadBtn.hidden = false;
  }
});

// ---- Dynamic-translation section ----------------------------------------

function refreshDynamicUi() {
  const isGoogle = engineSelect.value === "google";
  dynamicOptions.hidden = !dynamicInput.checked;
  keyRow.hidden = !isGoogle;
  keyHelp.hidden = !isGoogle;
  if (!isGoogle) setKeyStatus("", "");
  engineNote.textContent = t(isGoogle ? "noteGoogle" : "noteBuiltin");
  refreshBuiltinStatus();
}

saveKeyBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  await chrome.storage.local.set({ googleApiKey: key });
  if (!key) {
    setKeyStatus(t("keyCleared"), "");
    return;
  }
  // Verify the key end-to-end with a one-word translation.
  setKeyStatus(t("keyVerifying"), "");
  chrome.runtime.sendMessage(
    { type: "translateBatch", texts: ["hello"], target: "zh-CN" },
    (resp) => {
      if (chrome.runtime.lastError || !resp || resp.error) {
        const reason = resp?.error ?? chrome.runtime.lastError?.message ?? "no response";
        setKeyStatus(t("keyFailed", { err: reason }), "err");
      } else {
        setKeyStatus(t("keyVerified"), "ok");
      }
    }
  );
});

// ---- Settings wiring -----------------------------------------------------

enabledInput.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

langSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ lang: langSelect.value });
  uiLang = langSelect.value;
  applyI18n();
  refreshDynamicUi();
});

dynamicInput.addEventListener("change", () => {
  chrome.storage.sync.set({ dynamicEnabled: dynamicInput.checked });
  refreshDynamicUi();
});

engineSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ engine: engineSelect.value });
  refreshDynamicUi();
});

// ---- Init ----------------------------------------------------------------

(async () => {
  STRINGS = await (await fetch("popup-locales.json")).json();
  const items = await chrome.storage.sync.get(DEFAULTS);
  enabledInput.checked = items.enabled;
  langSelect.value = items.lang;
  dynamicInput.checked = items.dynamicEnabled;
  engineSelect.value = items.engine;
  uiLang = items.lang;
  applyI18n();
  refreshDynamicUi();
  const { googleApiKey } = await chrome.storage.local.get({ googleApiKey: "" });
  keyInput.value = googleApiKey;
})();
