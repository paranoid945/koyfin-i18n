#!/usr/bin/env node
/**
 * Generates `dist/audit.js` from `tools/audit.template.js` by embedding the
 * current master dictionary. Paste the generated file into the DevTools
 * console on koyfin.com to audit dictionary coverage — see the template
 * header for details.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const root = path.join(__dirname, "..");
const master = JSON.stringify(
  yaml.load(fs.readFileSync(path.join(__dirname, "translations.master.yaml"), "utf8"))
);
const scopes = fs.readFileSync(path.join(root, "src", "scopes.json"), "utf8");
const template = fs.readFileSync(path.join(__dirname, "audit.template.js"), "utf8");

// replaceAll: the placeholders also appear in the template's doc comment.
// A function replacement avoids `$` being treated as a substitution pattern.
const out = template
  .replaceAll("__MASTER__", () => master.trim())
  .replaceAll("__SCOPES__", () => scopes.trim());

const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, "audit.js");
fs.writeFileSync(outPath, out, "utf8");

console.log(`Wrote ${path.relative(root, outPath)}`);
console.log("Usage:");
console.log("  1. Open a koyfin.com page (any login state, extension on or off).");
console.log("  2. Paste the contents of dist/audit.js into the DevTools console.");
console.log("  3. Save the JSON report (clipboard) to a file, e.g. audits/2026-07-11.json.");
console.log("  4. Compare two reports: node tools/audit-diff.js <old.json> <new.json>");
