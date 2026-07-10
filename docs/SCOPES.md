# Translation Scope Whitelist

`src/scopes.json` decides **where** on the page translation is allowed to
happen. The content script only walks DOM subtrees matching a `whitelist`
selector, skipping anything matching an `exclude` selector. Everything
outside the whitelist — data cells, tickers, company and fund names,
timestamps — is structurally untouchable. Within a scope, exact-match
dictionary lookup is the second protection layer: strings not in the
dictionary (e.g. user-named watchlists) are left as-is.

The whitelist was derived from `tools/scope-recon.js` reports of four real
app.koyfin.com pages (home, screener, stock chart page, watchlist) in
July 2026.

## Why `[class*=...]` selectors

Koyfin uses CSS Modules: class names look like
`navi-panel-list-item__naviPanelListItem___xYzAb` — a stable semantic
prefix plus a `___<hash>` suffix that changes on every deploy. Matching
the prefix with `[class*=...]` survives redeploys. Koyfin has almost no
`data-testid` attributes, so class prefixes and ARIA roles are the most
stable hooks available.

## Whitelist (translate inside these)

| Selector (abridged) | UI region | Sample strings |
| --- | --- | --- |
| `nav[class*='navi-panel-layout'] a[class*='navi-panel-list-item']` | Sidebar links | Market News, My Watchlists, Financial Analysis |
| `nav[class*='navi-panel-layout'] button[class*='navi-panel-section']` | Sidebar section headers | Favorites, Security Analysis, Market Overview |
| `[class*='table-styles__table__head']` | Table header cells | Ticker, Name, Last Price, Market Cap |
| `[class*='mobile-table-header__headerCell']` | Sidebar mini-table headers | Security, Last, 1D % |
| `button[class*='base-button']`, `button[class*='primary-button']` | All standard buttons (incl. `aria-label`/`title`) | Columns, Sort, Download, Add Metric |
| `[class*='top-header__topHeader__root']` | Top header bar | Upgrade, Help Center |
| `[class*='console__label']` | Search console placeholder label | Search for a name, ticker, or function |
| `[class*='koy-tab-item__koyTabItem__label']` | Page tabs | Stock Screener, ETFs and MFs |
| `label[class*='text-label']` | Generic UI labels, incl. feature blurbs | My Screens, Universe Criteria: |
| `[class*='chart-toolbar-styles__toolbar']` | Chart toolbar | Show Table, Export, Settings, Daily |
| `[class*='chart-sidebar-styles__tabs']`, `h2[class*='chart-sidebar-styles__headerTitle']`, `[class*='chart-sidebar-styles__securityBtn']` | Chart sidebar chrome | Selections, Templates, Add Ticker |
| `[class*='block-string__label']` | Quote-box metric names | Sector, Forward P/E, Next Earnings Date |
| `[class*='content-sidebar-header']` | Content sidebar header | My Watchlists |
| `[class*='menu-input__value']` | Dropdown current values | Daily |
| `[class*='rc-dialog-content']` | Modal dialogs | Get Started, Close |
| `a[class*='skipLink']` | Accessibility skip link | Skip to main content |

## Exclude (never translate, even inside a whitelisted scope)

| Selector | What it is | Why excluded |
| --- | --- | --- |
| `[class*='navi-panel-func']` | Sidebar function shortcodes | Codes like `des`, `myw` must stay typeable |
| `[class*='navi-panel-ticker-info']` | Ticker widget in sidebar | AAPL / Apple Inc. are data |
| `[class*='quote-box-security-dropdown']` | Company name inside the quote-box button | Only place a company name sits inside a whitelisted button |
| `[class*='time-frame-options']`, `[class*='time-range']` | Chart timeframe codes and date range | `1m`/`ytd` are financial conventions; dates are data |

## Considered and rejected

- **Cookie consent banner (`.cky-*`, CookieYes)** — third-party component,
  not Koyfin UI. Decision (2026-07-11): do not translate third-party
  components.
- **Data regions** (`lde-table-row__cell`, `content-table__row`,
  `router-link__root` ticker links, quote-box values, `As of ...`
  timestamps) — the entire point of the whitelist design; never add these.

## Maintenance

1. **After a Koyfin UI update** (or periodically): run
   `tools/scope-recon.js` in the DevTools console on the affected page
   (extension disabled). If a known region stops matching its selector,
   Koyfin renamed the component prefix — update the selector here and in
   `src/scopes.json`.
2. **New UI regions**: classify the new scope (UI vs. data), add the
   selector to `src/scopes.json`, and record it in the tables above with
   sample strings.
3. **Missing translations inside existing scopes**: run `npm run audit`,
   paste `dist/audit.js` in the console — candidates it reports are
   in-scope by construction; add them to
   `tools/translations.master.yaml` and run `npm run build`.
4. Keep `src/scopes.json` and this document in sync — the JSON is what
   ships; this file is the decision log.
