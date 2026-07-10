#!/usr/bin/env node
/**
 * Generates the extension icons (icons/icon{16,32,48,128}.png) without any
 * dependencies: pixels are drawn procedurally and encoded as PNG using
 * Node's built-in zlib.
 *
 * Design: dark navy rounded square, white "K", teal underline accent —
 * hinting at Koyfin plus a "translated layer".
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZES = [16, 32, 48, 128];
const BG = [13, 33, 55]; // dark navy
const FG = [255, 255, 255]; // white "K"
const ACCENT = [45, 212, 191]; // teal underline

// Distance from point (px,py) to segment (ax,ay)-(bx,by), in unit space.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Coverage (0..1) of the icon artwork at unit coordinates (x,y).
// Returns [r,g,b,a-like coverage] layered over the background.
function sample(x, y) {
  // Rounded-square mask
  const r = 0.22;
  const cx = Math.max(r, Math.min(1 - r, x));
  const cy = Math.max(r, Math.min(1 - r, y));
  if (Math.hypot(x - cx, y - cy) > r) return null; // transparent

  const stroke = 0.075;
  // "K" strokes
  const k =
    Math.min(
      segDist(x, y, 0.33, 0.2, 0.33, 0.66), // vertical bar
      segDist(x, y, 0.35, 0.45, 0.68, 0.2), // upper diagonal
      segDist(x, y, 0.44, 0.39, 0.7, 0.66) // lower diagonal
    ) <= stroke;
  if (k) return FG;

  // Teal accent underline
  if (segDist(x, y, 0.3, 0.8, 0.72, 0.8) <= 0.045) return ACCENT;

  return BG;
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 3; // supersampling factor for antialiasing
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = sample(u, v);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      // Un-premultiply against the sample count so covered pixels keep color
      const cov = a / 255 || 1;
      px[i] = Math.round(r / cov);
      px[i + 1] = Math.round(g / cov);
      px[i + 2] = Math.round(b / cov);
      px[i + 3] = Math.round(alpha);
    }
  }
  return px;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // Prefix each scanline with filter byte 0 (None)
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log(`Wrote ${path.relative(path.join(__dirname, ".."), file)}`);
}
