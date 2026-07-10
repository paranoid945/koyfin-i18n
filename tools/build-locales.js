#!/usr/bin/env node
/**
 * Generates per-locale dictionary files in `locales/` from
 * `tools/translations.master.yaml`.
 *
 * The master file maps each English source string to its translations:
 *   Market News:
 *     zh_CN: 市场新闻
 *     ...
 *
 * Each generated `locales/<lang>.json` maps English -> translation for a
 * single language, so the content script only loads the language it needs.
 *
 * The script fails if any entry is missing a language, which keeps all
 * locales in sync with the master file.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const LANGS = ["zh_CN", "zh_TW", "ja", "ko", "de", "fr", "es"];

const root = path.join(__dirname, "..");
const masterPath = path.join(__dirname, "translations.master.yaml");
const outDir = path.join(root, "locales");

const master = yaml.load(fs.readFileSync(masterPath, "utf8"));

const errors = [];
for (const [key, entry] of Object.entries(master)) {
  for (const lang of LANGS) {
    if (typeof entry[lang] !== "string" || entry[lang].length === 0) {
      errors.push(`"${key}" is missing translation for "${lang}"`);
    }
  }
  for (const lang of Object.keys(entry)) {
    if (!LANGS.includes(lang)) {
      errors.push(`"${key}" has unknown language "${lang}"`);
    }
  }
}
if (errors.length > 0) {
  console.error("Master dictionary validation failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const keys = Object.keys(master).sort((a, b) => a.localeCompare(b));
for (const lang of LANGS) {
  const dict = {};
  for (const key of keys) dict[key] = master[key][lang];
  const outPath = path.join(outDir, `${lang}.json`);
  fs.writeFileSync(outPath, JSON.stringify(dict, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(root, outPath)} (${keys.length} entries)`);
}
