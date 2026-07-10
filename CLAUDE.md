# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome extension (Manifest V3) that translates Koyfin's (app.koyfin.com) static UI
into 7 languages via an offline exact-match dictionary. Unofficial, open source.
All code, comments, and docs are in English (project convention).

## Commands

```sh
npm install            # dev deps for build tools only (js-yaml); the extension ships dependency-free
npm run build          # regenerate locales/*.json + icons/*.png from sources
npm run audit          # build dist/audit.js (dictionary-coverage audit, pasted into DevTools)
npm run package        # build + zip -> dist/koyfin-i18n-<version>.zip (Chrome Web Store upload)
```

`node tools/build-locales.js` also validates the master dictionary (fails if any
entry is missing one of the 7 languages).

There is no checked-in test suite. Changes to `src/content.js` have been verified
with a jsdom harness (stub `chrome.*`, `fetch`, `requestIdleCallback`; run the
content script via `vm.runInContext` on Koyfin-like markup). To manually verify:
load the repo root unpacked at `chrome://extensions`, and **reload the extension
there** after every change — page refresh alone does not pick up new content
scripts or locales.

## Architecture: two-layer translation safety

The core design problem: distinguish static UI (translate) from financial data —
tickers, company/fund names — that may literally equal dictionary words (a fund
named "High", a nav item "Close"). Two independent layers:

1. **Scope whitelist** (`src/scopes.json`): dictionary translation only happens
   inside DOM subtrees matching `whitelist` selectors (nav, table headers,
   buttons, dialogs, labels); `exclude` selectors punch holes inside them
   (ticker widgets, function shortcodes). Data regions are structurally
   unreachable.
2. **Exact-match dictionary**: within a scope, unknown strings (e.g. user-named
   watchlists) are never touched.

A third scope category, `dynamic`, marks machine-translated content regions
(news, descriptions) — opt-in via the popup, engine = Chrome built-in
Translator API (on-device, default) or Google Cloud Translation v2 via the
user's own key (`src/background.js` proxies those calls; key lives in
`chrome.storage.local`, never sync). Dictionary hits win inside dynamic scopes;
per-language cache (`dynCache`); `dynamic` is empty until populated from recon
reports of the news/profile pages.

`docs/SCOPES.md` is the human decision log for the whitelist (including
deliberately rejected scopes, e.g. the third-party CookieYes banner). Any change
to `src/scopes.json` must be mirrored there.

## Data flow

```
tools/translations.master.yaml   (single source of truth, thematic sections, all 7 langs per key)
        │  node tools/build-locales.js
        ▼
locales/<lang>.json              (generated — never edit directly)
        │  fetch(chrome.runtime.getURL(...)) at page load
        ▼
src/content.js                   (translates within scopes; settings in chrome.storage.sync)
```

`tools/build-audit.js` embeds the master dictionary AND `src/scopes.json` into
`tools/audit.template.js` → `dist/audit.js`.

## src/content.js invariants

- **Own-write tracking**: WeakMaps store `{ original, translated }` per text
  node / attribute. On every pass: if current content === `translated`, the
  cached `original` is still the source; otherwise the app re-rendered and the
  *current* content is the new source (stale cache must be dropped, never
  written back). Breaking this reintroduces a bug where React content swaps
  (e.g. walkthrough next/prev) get clobbered by stale translations.
- **Pre-paint translation**: MutationObserver callbacks are microtasks (run
  before the next paint). Small batches are translated synchronously there
  (SYNC_BUDGET_MS) so no English flash is visible; overflow goes to
  requestIdleCallback slices (SLICE_BUDGET_MS). Don't move the fast path back
  to idle-only — that causes a visible flash on every SPA update.
- **No-op write guards** (`if (value !== next)`) prevent observer feedback loops.
- **Static/dynamic path ownership**: dynamic (machine) translation records carry
  a `lang` field; static records don't. The dictionary pass MUST skip nodes
  holding a live dynamic translation (`rec.lang !== undefined && value ===
  rec.translated`) — static and dynamic scopes overlap on real pages (news
  headlines are `label.text-label` inside `koy-news-item`), and without this
  guard the two paths revert/re-apply each other forever and freeze the page.
- **Engine circuit breaker**: `dynamicBroken` latches on any engine failure and
  resets only on settings changes — otherwise every DOM mutation retries the
  full failing batch.
- The 300-char text length cap is duplicated in `tools/audit.template.js`
  (`looksLikeUiLabel`) — keep them in sync, and keep the skip rules
  (SKIP_SUBTREE_TAGS, namespace check, exclude selectors) in sync as well.

## Koyfin DOM facts (empirical, from recon reports)

- CSS Modules class names: `semantic-prefix___hash` where the hash changes per
  deploy — selectors must use `[class*='semantic-prefix']`, never full class
  names. Almost no `data-testid` exists; class prefixes + ARIA roles are the
  stable hooks.
- Nav labels can carry sibling "function shortcode" elements (`des`, `myw`) that
  must stay untranslated (excluded scope).

## Maintenance workflow (site updates / missing translations)

1. `tools/scope-recon.js` — self-contained; paste into DevTools console with the
   extension disabled. Inventories ALL page text grouped by structural scope
   signature; report auto-downloads as JSON. Use to discover/verify scopes.
2. `dist/audit.js` (from `npm run audit`) — scans only whitelisted scopes;
   reports dictionary keys seen + in-scope untranslated candidates.
3. `node tools/audit-diff.js old.json new.json` — diffs two audit reports; exits
   2 when new strings appeared or known keys stopped matching (Koyfin renamed UI).
4. Add entries to `tools/translations.master.yaml` (all 7 languages required),
   then `npm run build`.

## Gotchas

- `Translator.availability()` is masked per-origin (anti-fingerprinting): an
  origin that never called `create()` gets "downloadable" even when the pack
  is installed. The popup therefore asks the content script for ground truth
  (`builtinStatus` message) and only falls back to availability probing; never
  present raw availability as "installed / not installed". Pack downloads need
  a user gesture — popup clicks have one, content scripts may not (that's what
  the engine circuit breaker catches).

- Editing repo files with PowerShell `Get-Content`/`Set-Content` corrupts UTF-8
  (reads as ANSI on this machine). Use the Read/Write/Edit tools instead.
- Parameterized strings ("Collapse {section}", "Drag to reorder {x}") and the
  large financial-metric column namespace ("Total Revenues, CAGR (5Y TTM)") are
  known, deliberate dictionary gaps — pattern matching / a dedicated metrics
  dictionary are future work, not bugs to patch ad hoc.
- Initial page load can flash English (content script runs at `document_idle`);
  accepted trade-off — do not "fix" by injecting at `document_start` with
  render-blocking.
