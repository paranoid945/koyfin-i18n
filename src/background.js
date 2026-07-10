/**
 * Background service worker: proxies dynamic-translation requests to the
 * Google Cloud Translation API (v2) when the user has selected the
 * "google" engine and provided their own API key.
 *
 * The key is kept in chrome.storage.local (never synced) and only ever
 * leaves the browser as part of the request to translation.googleapis.com.
 * The Chrome built-in engine does not go through this worker at all — it
 * runs on-device inside the content script.
 */

"use strict";

const GOOGLE_ENDPOINT = "https://translation.googleapis.com/language/translate/v2";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "translateBatch") return false;
  (async () => {
    const { googleApiKey } = await chrome.storage.local.get({ googleApiKey: "" });
    if (!googleApiKey) {
      sendResponse({ error: "missing-key" });
      return;
    }
    const res = await fetch(
      `${GOOGLE_ENDPOINT}?key=${encodeURIComponent(googleApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: msg.texts,
          source: "en",
          target: msg.target,
          format: "text",
        }),
      }
    );
    if (!res.ok) {
      sendResponse({ error: `http-${res.status}` });
      return;
    }
    const data = await res.json();
    sendResponse({
      translations: data.data.translations.map((t) => t.translatedText),
    });
  })().catch((err) => sendResponse({ error: String(err) }));
  return true; // keep the message channel open for the async response
});
