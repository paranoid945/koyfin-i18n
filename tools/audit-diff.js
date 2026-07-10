#!/usr/bin/env node
/**
 * Compares two audit reports produced by dist/audit.js and highlights what
 * changed on the site between the two runs:
 *
 *   - NEW untranslated strings (likely new UI after a site update)
 *   - untranslated strings that disappeared (renamed or removed UI)
 *   - dictionary keys that stopped matching (Koyfin renamed a label the
 *     dictionary still expects — these entries may be dead weight)
 *
 * Usage: node tools/audit-diff.js <old-report.json> <new-report.json>
 */

"use strict";

const fs = require("fs");

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error("Usage: node tools/audit-diff.js <old-report.json> <new-report.json>");
  process.exit(1);
}

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const oldReport = load(oldPath);
const newReport = load(newPath);

const texts = (report) => new Set(report.unmatched.map((u) => u.text));
const oldUnmatched = texts(oldReport);
const newUnmatched = texts(newReport);
const oldMatched = new Set(oldReport.matchedKeys);
const newMatched = new Set(newReport.matchedKeys);

const appeared = [...newUnmatched].filter((t) => !oldUnmatched.has(t)).sort();
const disappeared = [...oldUnmatched].filter((t) => !newUnmatched.has(t)).sort();
const lostKeys = [...oldMatched].filter((k) => !newMatched.has(k)).sort();
const gainedKeys = [...newMatched].filter((k) => !oldMatched.has(k)).sort();

function section(title, items) {
  console.log(`\n${title} (${items.length})`);
  if (items.length === 0) console.log("  (none)");
  for (const item of items) console.log(`  - ${item}`);
}

console.log(`Old: ${oldReport.url} @ ${oldReport.date}`);
console.log(`New: ${newReport.url} @ ${newReport.date}`);

section("NEW untranslated strings — consider adding to the dictionary", appeared);
section("Untranslated strings no longer present", disappeared);
section("Dictionary keys that stopped matching — possibly renamed by Koyfin", lostKeys);
section("Dictionary keys newly matched", gainedKeys);

// Non-zero exit when something needs attention, so this can gate a script.
process.exit(appeared.length > 0 || lostKeys.length > 0 ? 2 : 0);
