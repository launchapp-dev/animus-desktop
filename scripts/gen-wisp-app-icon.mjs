import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source art for the macOS/Windows/Linux app (Dock/Finder) icon — the Wisp
// flame on the dark rounded square, per the design system's "512 · app icon"
// (§07 Sizing). Feed the output to `pnpm tauri icon` to generate the full set.
const OUT = join(dirname(fileURLToPath(import.meta.url)), "wisp-app-icon-source.png");
const BODY = "M40 11 C51 17 53 33 45 44 C36 53 21 51 17 40 C13 29 24 27 27 19 C30 11 34 8 40 11 Z";

const SIZE = 1024;
const TILE = 832;          // squircle inset from the 1024 canvas (macOS margin)
const TILE_OFF = (SIZE - TILE) / 2;
const FLAME = 520;         // ~63% of the tile, matching the design ratio
const FLAME_OFF = (SIZE - FLAME) / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c1813"/>
      <stop offset="1" stop-color="#0f0d0a"/>
    </linearGradient>
  </defs>
  <rect x="${TILE_OFF}" y="${TILE_OFF}" width="${TILE}" height="${TILE}" rx="186" fill="url(#bg)"/>
  <svg x="${FLAME_OFF}" y="${FLAME_OFF}" width="${FLAME}" height="${FLAME}" viewBox="0 0 64 64">
    <path d="${BODY}" fill="#3ed3a4"/>
    <circle cx="31.5" cy="30" r="2.7" fill="#15110d"/>
    <circle cx="40.5" cy="30" r="2.7" fill="#15110d"/>
  </svg>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log("wisp app-icon source written to", OUT);
