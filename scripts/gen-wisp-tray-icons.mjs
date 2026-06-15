import sharp from "sharp";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons", "wisp");
const BODY = "M40 11 C51 17 53 33 45 44 C36 53 21 51 17 40 C13 29 24 27 27 19 C30 11 34 8 40 11 Z";

// macOS caps the menu-bar icon at the bar height, and subtle eye shapes don't
// read at that size — so the tray uses only THREE boldly-distinct states (the
// five in-app expressions collapse onto these in tray.rs::icon_bytes):
//   active   — round open eyes (daemon running / a cycle running / just passed)
//   resting  — closed eyes (daemon stopped)
//   needs-you — eyes + a knockout exclamation (not installed / blocked / failed)
// Tight viewBox so the flame fills the icon; eyes/strokes are oversized to
// survive the downscale. Everything is a black template image; macOS recolors
// it for light/dark menu bars and the eyes knock out to the bar background.
const VIEWBOX = "8 6 48 48";

const EYES = {
  active: `<circle cx="31.5" cy="30" r="4.2"/><circle cx="40.5" cy="30" r="4.2"/>`,
  resting: `<path d="M27 30 q4.5 4 9 0 M37 30 q4.5 4 9 0" stroke="#000" stroke-width="3.6" stroke-linecap="round" fill="none"/>`,
  "needs-you": `<circle cx="30" cy="31" r="3.6"/><circle cx="39" cy="31" r="3.6"/><path d="M47 16 v6.5" stroke="#000" stroke-width="3" stroke-linecap="round"/><circle cx="47" cy="27" r="1.7"/>`,
};

function svg(state) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}">
    <mask id="m"><rect x="0" y="0" width="64" height="64" fill="#fff"/><g fill="#000" stroke="#000">${EYES[state]}</g></mask>
    <path d="${BODY}" fill="#000" mask="url(#m)"/>
  </svg>`;
}

await mkdir(OUT, { recursive: true });
// Remove the obsolete per-expression icons from the earlier 5-state scheme.
for (const old of ["awake", "working", "done"]) {
  for (const suffix of ["", "@2x"]) {
    await rm(join(OUT, `${old}${suffix}.png`), { force: true });
  }
}
for (const state of Object.keys(EYES)) {
  for (const [suffix, px] of [["", 22], ["@2x", 44]]) {
    await sharp(Buffer.from(svg(state))).resize(px, px).png().toFile(join(OUT, `${state}${suffix}.png`));
  }
}
console.log("wisp tray icons written to", OUT);
