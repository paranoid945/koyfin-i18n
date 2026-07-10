# Koyfin UI Translator

A Chrome extension that translates the static interface of
[Koyfin](https://app.koyfin.com) — navigation menus, page tabs, table
headers, buttons and common labels — into your language, using a fully
offline dictionary.

## Supported languages

- 简体中文 (Simplified Chinese)
- 繁體中文 (Traditional Chinese)
- 日本語 (Japanese)
- 한국어 (Korean)
- Deutsch (German)
- Français (French)
- Español (Spanish)

## What it does (and doesn't)

- ✅ Translates **static/generic UI strings** (e.g. sidebar items like
  "Market News", "My Watchlists", table headers, buttons) via exact-match
  dictionary lookup — and only inside **whitelisted UI scopes**
  (`src/scopes.json`): navigation, tabs, table headers, buttons, dialogs.
  Data regions (table cells, tickers, company/fund names, the quote box)
  are structurally out of scope and can never be modified, even when a
  name happens to equal a dictionary word. Within a scope, exact-match is
  the second protection layer: unknown strings (e.g. user-named
  watchlists) stay as-is.
- ❌ Does **not** translate dynamic content such as news articles, company
  descriptions, or transcripts. Machine-translation of dynamic content
  (e.g. via an external translation engine) may be considered in a future
  version.
- 🔒 No data leaves your browser. No network requests, no analytics, no
  tracking. The only permission used is `storage` (to remember your
  language choice).

## Performance

The extension is designed to have no perceptible impact on Koyfin:

- Dictionary lookups are O(1) `Map` gets against a single small JSON file
  loaded once per page.
- Only whitelisted UI subtrees are walked; large data regions are never
  traversed at all.
- SPA re-renders are captured by a `MutationObserver`. Small batches are
  translated synchronously inside the observer callback — a microtask that
  runs before the next paint, so there is no flash of untranslated
  English. Only oversized batches spill over to `requestIdleCallback`
  slices with a time budget, so translation never blocks rendering or
  input.
- Original strings are stored in `WeakMap`s, so removed DOM nodes are
  garbage-collected normally and translations can be reverted instantly
  when you switch language or disable the extension.

## Install (development)

1. Install build-tool dependencies and build the generated assets
   (locale files and icons):

   ```sh
   npm install
   npm run build
   ```

2. Open `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked**, and select this repository's root folder.

3. Visit <https://app.koyfin.com>, click the extension icon, and pick a
   language.

## Project layout

```
manifest.json                  Extension manifest (MV3)
src/content.js                 Dictionary-based DOM translator (scope-whitelisted)
src/scopes.json                UI scope whitelist (decision log: docs/SCOPES.md)
src/popup.{html,js,css}        Language picker popup
locales/*.json                 Generated per-language dictionaries
icons/*.png                    Generated icons
tools/translations.master.yaml Single source of truth for all translations
tools/build-locales.js         Generates locales/*.json from the master file
tools/make-icons.js            Generates icons (no dependencies)
tools/package.js               Builds dist/koyfin-i18n-<version>.zip
docs/SCOPES.md                 Scope whitelist decision log
docs/PUBLISHING.md             Chrome Web Store publishing guide
```

## Scope reconnaissance (building the translation whitelist)

The extension translates only inside whitelisted UI scopes (nav, tabs,
table headers, buttons, ...) so that dynamic data — tickers, company and
fund names, prices — can never be touched. The whitelist is derived from
real pages:

1. Open an app.koyfin.com page with the extension **disabled**.
2. Paste `tools/scope-recon.js` into the DevTools console (it is
   self-contained — no build step).
3. It groups every English string on the page by a structural scope
   signature built from stable DOM features (`data-testid`, ARIA roles,
   semantic tags; CSS-in-JS hash classes are normalized to their stable
   prefix) and downloads a JSON report, including a ready-made CSS
   selector and the full text inventory per scope.
4. Classify each scope as UI (translate) or data (exclude). The kept
   selectors become the whitelist in `src/scopes.json` — see
   [docs/SCOPES.md](docs/SCOPES.md) for the current decision log.

Repeat on a few representative pages (home, watchlist, a security page)
and merge the results.

## Auditing dictionary coverage

The dictionary is hand-curated, so it should be re-checked against the
live site periodically (and after Koyfin ships UI changes):

```sh
npm run audit          # generates dist/audit.js
```

Paste `dist/audit.js` into the DevTools console on an app.koyfin.com page
(logged in is fine; the extension may be on or off). It scans only the
whitelisted scopes with the same rules as the content script and reports:

- how many dictionary keys actually appear on the page, and
- in-scope English strings that are **not** in the dictionary — sorted by
  frequency, ready to be added to `tools/translations.master.yaml`.

The report is downloaded as a JSON file (and copied to the clipboard).
Save it (e.g. `audits/2026-07-11-home.json`) and diff two runs to catch
site updates:

```sh
node tools/audit-diff.js audits/old.json audits/new.json
```

The diff lists newly appeared untranslated strings and dictionary keys
that stopped matching (i.e. labels Koyfin renamed). It exits non-zero when
either list is non-empty, so it can gate a script.

## Contributing translations

Edit `tools/translations.master.yaml` (every key must provide all seven
languages), then run `node tools/build-locales.js`. Do not edit
`locales/*.json` directly — they are generated.

Known limitation: the dictionary is context-free — one translation per
English string across all scopes. A few words are ambiguous (e.g. "Close"
the button vs. "Close" the price column); each entry picks the meaning
most common in Koyfin's UI. The scope whitelist keeps such words from
ever being touched inside data regions.

Maintaining `src/scopes.json`: see [docs/SCOPES.md](docs/SCOPES.md) for
what each selector covers, the decision log (including scopes we
deliberately do not translate), and the update workflow.

## Packaging for the Chrome Web Store

```sh
npm run package
```

This produces `dist/koyfin-i18n-<version>.zip`. See
[docs/PUBLISHING.md](docs/PUBLISHING.md) for the full store submission
walkthrough.

## Disclaimer

This is an unofficial, open-source project and is not affiliated with or
endorsed by Koyfin.

## License

[MIT](LICENSE)
