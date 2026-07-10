/** Popup: reads and writes the shared settings in chrome.storage.sync. */

"use strict";

const DEFAULTS = { enabled: false, lang: "zh_CN", dynamicEnabled: false, engine: "builtin" };

const NOTES = {
  builtin:
    "Uses Chrome's on-device translation (Chrome 138+). Free and private — nothing leaves your browser. The language pack downloads on first use.",
  google:
    "Sends visible dynamic text to the Google Cloud Translation API using your own key (500k characters/month free tier). The key is stored locally and never synced.",
};

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
const engineNote = document.getElementById("engine-note");
const statusRow = document.getElementById("builtin-status-row");
const statusEl = document.getElementById("builtin-status");
const downloadBtn = document.getElementById("download-pack");

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
    setStatus("Built-in translator unavailable — requires Chrome 138+.", "err");
    return;
  }
  setStatus("Checking language pack…", "");
  const { lang } = await chrome.storage.sync.get({ lang: DEFAULTS.lang });

  // Ground truth first: is the translator actually running on the page?
  const page = await queryPageStatus(lang);
  if (page?.active) {
    setStatus("Translator active on this page ✓", "ok");
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
    setStatus("Language pack ready ✓", "ok");
  } else if (downloading) {
    setStatus(`Language pack downloading… (${detail})`, "warn");
  } else if (downloadable) {
    // "downloadable" may just mean "installed but never used by this
    // extension" — clicking Enable is instant in that case.
    downloadTarget = downloadable.target;
    setStatus("Not initialized — click Enable (instant if already installed).", "warn");
    downloadBtn.hidden = false;
  } else {
    setStatus(`Language not supported by the built-in translator (${detail})`, "err");
  }
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` status--${kind}` : ""}`;
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
          setStatus(`Downloading language pack… ${Math.round(e.loaded * 100)}%`, "warn");
        });
      },
    });
    setStatus("Language pack ready ✓", "ok");
    // Nudge content scripts to retry (resets their engine circuit breaker).
    chrome.storage.sync.set({ engineNonce: Date.now() });
  } catch (err) {
    setStatus(`Download failed: ${err.message ?? err}`, "err");
    downloadBtn.hidden = false;
  }
});

function refreshDynamicUi() {
  dynamicOptions.hidden = !dynamicInput.checked;
  keyRow.hidden = engineSelect.value !== "google";
  engineNote.textContent = NOTES[engineSelect.value] ?? "";
  refreshBuiltinStatus();
}

chrome.storage.sync.get(DEFAULTS, (items) => {
  enabledInput.checked = items.enabled;
  langSelect.value = items.lang;
  dynamicInput.checked = items.dynamicEnabled;
  engineSelect.value = items.engine;
  refreshDynamicUi();
});

chrome.storage.local.get({ googleApiKey: "" }, (items) => {
  keyInput.value = items.googleApiKey;
});

enabledInput.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

langSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ lang: langSelect.value });
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

keyInput.addEventListener("change", () => {
  chrome.storage.local.set({ googleApiKey: keyInput.value.trim() });
});
