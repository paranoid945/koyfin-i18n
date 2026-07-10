#!/usr/bin/env node
/**
 * Builds locales + icons, then zips the distributable files into
 * `dist/koyfin-i18n-<version>.zip`, ready for Chrome Web Store upload.
 *
 * Uses PowerShell's Compress-Archive on Windows and `zip` elsewhere,
 * so no npm dependencies are required.
 */

"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const INCLUDE = ["manifest.json", "src", "locales", "icons", "LICENSE"];

execFileSync(process.execPath, [path.join(__dirname, "build-locales.js")], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(__dirname, "make-icons.js")], { stdio: "inherit" });

const version = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8")
).version;
const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });
const outFile = path.join(distDir, `koyfin-i18n-${version}.zip`);
fs.rmSync(outFile, { force: true });

if (process.platform === "win32") {
  const paths = INCLUDE.map((p) => path.join(root, p)).join('", "');
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path "${paths}" -DestinationPath "${outFile}"`,
    ],
    { stdio: "inherit" }
  );
} else {
  execFileSync("zip", ["-r", outFile, ...INCLUDE], { cwd: root, stdio: "inherit" });
}

console.log(`Created ${path.relative(root, outFile)}`);
