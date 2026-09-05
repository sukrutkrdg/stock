/**
 * Renders the Mini App's images to `public/`.
 *
 *   node scripts/make-assets.mjs
 *
 * The manifest is strict about these: the icon must be 1024x1024 PNG with no
 * alpha channel, the splash 200x200, and the hero 1200x630 at 1.91:1. A wrong
 * size does not error at runtime — the app just fails to render properly in the
 * Base App directory — so they are generated rather than hand-cropped.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const INK = "#0a0b0d";
const SEGMENTS = [
  { color: "#76b900", fraction: 0.3 },
  { color: "#4a7dff", fraction: 0.24 },
  { color: "#ff9900", fraction: 0.2 },
  { color: "#e82127", fraction: 0.14 },
  { color: "#a3aab4", fraction: 0.12 },
];

/** The wordless Slate mark: the allocation ring the whole app is built around. */
function ring({ cx, cy, radius, thickness, gapDegrees = 3 }) {
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const arcs = SEGMENTS.map((segment) => {
    const length = Math.max(0, circumference * segment.fraction - (gapDegrees / 360) * circumference);
    const dash = `${length} ${circumference - length}`;
    const dashOffset = -circumference * offset;
    offset += segment.fraction;
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
      stroke="${segment.color}" stroke-width="${thickness}"
      stroke-dasharray="${dash}" stroke-dashoffset="${dashOffset}" />`;
  }).join("");

  // Rotated so the first segment starts at twelve o'clock rather than three,
  // which is where a reader's eye expects an allocation ring to begin.
  return `<g transform="rotate(-90 ${cx} ${cy})">${arcs}</g>`;
}

async function render(name, svg, width, height, flatten = true) {
  let pipeline = sharp(Buffer.from(svg)).resize(width, height);
  // No alpha on the icon: transparent corners render as black boxes in some
  // clients, which looks like a broken asset rather than a rounded icon.
  if (flatten) pipeline = pipeline.flatten({ background: INK });
  await pipeline.png({ compressionLevel: 9 }).toFile(`public/${name}`);
  console.log(`  ${name.padEnd(12)} ${width}x${height}`);
}

await mkdir("public", { recursive: true });

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${INK}"/>
  <circle cx="512" cy="512" r="316" fill="none" stroke="#1d2128" stroke-width="104"/>
  ${ring({ cx: 512, cy: 512, radius: 316, thickness: 104 })}
  <circle cx="512" cy="512" r="212" fill="${INK}"/>
</svg>`;

const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="${INK}"/>
  <circle cx="100" cy="100" r="62" fill="none" stroke="#1d2128" stroke-width="20"/>
  ${ring({ cx: 100, cy: 100, radius: 62, thickness: 20 })}
  <circle cx="100" cy="100" r="42" fill="${INK}"/>
</svg>`;

const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${INK}"/>
  <circle cx="942" cy="315" r="168" fill="none" stroke="#1d2128" stroke-width="56"/>
  ${ring({ cx: 942, cy: 315, radius: 168, thickness: 56 })}
  <text x="88" y="268" fill="#f3f5f8" font-family="Inter, Helvetica, Arial, sans-serif"
        font-size="92" font-weight="700" letter-spacing="-3">Slate</text>
  <text x="88" y="336" fill="#8d95a3" font-family="Inter, Helvetica, Arial, sans-serif"
        font-size="34" font-weight="500">Baskets of tokenized stocks on Base.</text>
  <text x="88" y="392" fill="#5d6472" font-family="Inter, Helvetica, Arial, sans-serif"
        font-size="30" font-weight="500">Build one. Buy it in a tap. Share it.</text>
  <rect x="88" y="452" width="228" height="60" rx="30" fill="#0052ff"/>
  <text x="202" y="491" fill="#ffffff" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif" font-size="26" font-weight="600">One signature</text>
</svg>`;

console.log("Rendering Mini App assets:");
await render("icon.png", icon, 1024, 1024);
await render("splash.png", splash, 200, 200);
await render("hero.png", hero, 1200, 630);
console.log("\nDone.");
