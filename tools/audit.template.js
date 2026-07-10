/**
 * Page audit script — TEMPLATE.
 *
 * `tools/build-audit.js` replaces __MASTER__ with the master dictionary and
 * writes the result to `dist/audit.js`. Paste that file into the DevTools
 * console on any koyfin.com page (works while logged in, and whether the
 * extension is enabled or not — translated strings are recognized via a
 * reverse lookup of all locale values).
 *
 * It scans ONLY inside the whitelisted UI scopes (src/scopes.json, embedded
 * as __SCOPES__ at build time) with the same skip rules as src/content.js,
 * and reports:
 *   - which dictionary keys are actually present on the page
 *   - in-scope English strings that are NOT in the dictionary (candidates
 *     to add to translations.master.yaml)
 * Data regions (tickers, company/fund names) are outside the whitelist and
 * never show up as candidates.
 *
 * The JSON report is downloaded as a file (and copied to the clipboard),
 * so it can be saved and compared later with tools/audit-diff.js.
 */

(() => {
  "use strict";

  const MASTER = __MASTER__;

  const SCOPES = __SCOPES__;
  const WHITELIST_SEL = SCOPES.whitelist.join(", ");
  const EXCLUDE_SEL = SCOPES.exclude.join(", ");

  const KEYS = new Set(Object.keys(MASTER));
  /** translated value -> English key, to recognize already-translated UI */
  const REVERSE = new Map();
  for (const [key, langs] of Object.entries(MASTER)) {
    for (const value of Object.values(langs)) REVERSE.set(value, key);
  }

  // Keep in sync with src/content.js
  const SKIP_SUBTREE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"]);
  const SKIP_TEXT_PARENT_TAGS = new Set(["TEXTAREA"]);
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const ATTRS = ["placeholder", "title", "aria-label"];

  function isSkipped(el) {
    return (
      el.namespaceURI !== HTML_NS ||
      SKIP_SUBTREE_TAGS.has(el.tagName) ||
      el.isContentEditable ||
      el.matches(EXCLUDE_SEL)
    );
  }

  /**
   * Heuristic: does this string look like static UI text (as opposed to
   * data — prices, tickers, dates)? Generous on length: scanning is
   * whitelist-scoped, so long strings are usually static feature blurbs,
   * which belong in the dictionary too.
   */
  function looksLikeUiLabel(s) {
    if (s.length < 2 || s.length > 300) return false;
    if (!/[a-z]/.test(s)) return false; // ALL-CAPS -> tickers, exchange codes
    const digits = (s.match(/\d/g) || []).length;
    if (digits / s.length > 0.3) return false; // mostly numeric -> data
    if (/[%$€£¥@#]/.test(s) && !KEYS.has(s)) return false; // values, emails
    if (/^\d{1,2}[:/.-]\d/.test(s)) return false; // dates and times
    return true;
  }

  function matchKey(s) {
    if (KEYS.has(s)) return s;
    if (s.endsWith(":") && KEYS.has(s.slice(0, -1))) return s.slice(0, -1);
    if (REVERSE.has(s)) return REVERSE.get(s); // page already translated
    return null;
  }

  const matchedKeys = new Set();
  /** unmatched candidate -> occurrence count */
  const unmatched = new Map();

  function consider(raw) {
    const s = raw.trim();
    if (!s) return;
    const key = matchKey(s);
    if (key) {
      matchedKeys.add(key);
    } else if (looksLikeUiLabel(s)) {
      unmatched.set(s, (unmatched.get(s) || 0) + 1);
    }
  }

  // Scan only whitelisted scopes. Nested scope roots are deduplicated by
  // skipping any root that sits inside another matching root.
  const visited = new Set();
  for (const scopeRoot of document.body.querySelectorAll(WHITELIST_SEL)) {
    if (scopeRoot.parentElement?.closest(WHITELIST_SEL)) continue;
    const walker = document.createTreeWalker(
      scopeRoot,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return isSkipped(node)
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT;
          }
          const p = node.parentElement;
          return p && !SKIP_TEXT_PARENT_TAGS.has(p.tagName)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );
    for (let node = scopeRoot; node; node = walker.nextNode()) {
      if (visited.has(node)) continue;
      visited.add(node);
      if (node.nodeType === Node.TEXT_NODE) {
        consider(node.nodeValue);
      } else {
        for (const attr of ATTRS) {
          const v = node.getAttribute(attr);
          if (v) consider(v);
        }
      }
    }
  }

  const report = {
    url: location.href,
    date: new Date().toISOString(),
    dictionarySize: KEYS.size,
    matchedKeys: [...matchedKeys].sort(),
    unmatched: [...unmatched.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([text, count]) => ({ text, count })),
  };

  console.log(
    `[koyfin-i18n audit] ${report.matchedKeys.length}/${KEYS.size} dictionary ` +
      `keys seen on this page; ${report.unmatched.length} untranslated candidates.`
  );
  console.table(report.unmatched.slice(0, 40));
  const json = JSON.stringify(report, null, 2);

  // Primary export: download the report as a file.
  try {
    const slug =
      location.pathname.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home";
    const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `koyfin-audit-${slug}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    console.log(`[koyfin-i18n audit] Report downloaded as ${a.download}`);
  } catch (err) {
    console.warn("[koyfin-i18n audit] Download failed:", err);
  }

  // Secondary export: DevTools clipboard helper.
  try {
    copy(json);
    console.log("[koyfin-i18n audit] Report also copied to clipboard.");
  } catch {
    // Not running in DevTools; the report object is still returned below.
  }
  return report;
})();
