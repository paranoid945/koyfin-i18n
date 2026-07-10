/** Popup: reads and writes the shared settings in chrome.storage.sync. */

"use strict";

const DEFAULTS = { enabled: false, lang: "zh_CN" };

const enabledInput = document.getElementById("enabled");
const langSelect = document.getElementById("lang");

chrome.storage.sync.get(DEFAULTS, (items) => {
  enabledInput.checked = items.enabled;
  langSelect.value = items.lang;
});

enabledInput.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

langSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ lang: langSelect.value });
});
