# Privacy Policy — Koyfin UI Translator

_Last updated: 2026-07-11_

Koyfin UI Translator does not collect, store, transmit, or share any user
data.

- **No data collection.** The extension does not collect personal
  information, browsing history, or usage analytics of any kind.
- **Static translation is fully offline.** Interface labels are translated
  from dictionary files bundled inside the extension. Nothing is sent to
  any server.
- **Optional dynamic translation.** If you enable "Translate dynamic
  content", visible dynamic text (e.g. news headlines) is translated by
  the engine you choose:
  - *Chrome built-in (default):* translation runs on your device via
    Chrome's Translator API. No text leaves your browser.
  - *Google Cloud Translation (optional):* only if you provide your own
    API key, the visible text to translate is sent to Google's
    translation service under your key and
    [Google Cloud's terms](https://cloud.google.com/terms). The developers
    of this extension never see this data.
- **Local settings only.** Your language preference and toggles are saved
  with Chrome's `storage.sync` API; your API key (if any) is saved with
  `storage.local` and is never synced or transmitted anywhere except to
  Google as part of your own translation requests.
- **Scope.** The extension only runs on `koyfin.com` pages and only reads
  the page's visible text in order to replace known interface labels and
  (when enabled) translate dynamic content.

If this policy ever changes, the update will be published in this
repository and in the Chrome Web Store listing.

Contact: open an issue at <https://github.com/paranoid945/koyfin-i18n/issues>.
