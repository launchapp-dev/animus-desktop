import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons", "wisp");
const BODY = "M40 11 C51 17 53 33 45 44 C36 53 21 51 17 40 C13 29 24 27 27 19 C30 11 34 8 40 11 Z";

// Eyes/accents as transparent knockout cut from the black body via an SVG mask.
const EYES = {
  awake: `<circle cx="31.5" cy="30" r="2.7"/><circle cx="40.5" cy="30" r="2.7"/>`,
  working: `<ellipse cx="32.5" cy="30" rx="2.9" ry="1.7"/><ellipse cx="41.5" cy="30" rx="2.9" ry="1.7"/>`,
  done: `<path d="M28.5 31 q3 -4.5 6 0 M37.5 31 q3 -4.5 6 0" stroke="#000" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
  resting: `<path d="M28.5 30 q3 2.5 6 0 M37.5 30 q3 2.5 6 0" stroke="#000" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
  "needs-you": `<path d="M28.5 30 h6 M37.5 30 h6" stroke="#000" stroke-width="2.6" stroke-linecap="round"/>`,
};

function svg(expr) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <mask id="m"><rect width="64" height="64" fill="#fff"/><g fill="#000" stroke="#000">${EYES[expr]}</g></mask>
    <path d="${BODY}" fill="#000" mask="url(#m)"/>
  </svg>`;
}

await mkdir(OUT, { recursive: true });
for (const expr of Object.keys(EYES)) {
  for (const [suffix, px] of [["", 16], ["@2x", 32]]) {
    await sharp(Buffer.from(svg(expr))).resize(px, px).png().toFile(join(OUT, `${expr}${suffix}.png`));
  }
}
console.log("wisp tray icons written to", OUT);
