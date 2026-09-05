/**
 * Captures App Store-style screenshots of the live app.
 *
 *   node scripts/make-screenshots.mjs [origin]
 *
 * Base's dashboard requires exactly 1284 x 2778 px — an iPhone 14 Pro Max
 * frame. That is 428 x 926 CSS pixels at a device pixel ratio of 3, so the
 * capture is taken at that ratio rather than by upscaling a smaller shot:
 * upscaled text goes soft, and a blurry screenshot is the first thing a
 * reader notices in an app directory.
 *
 * Drives the Chrome already installed on this machine through puppeteer-core,
 * in its own profile directory so it never touches the user's browser session.
 */
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGIN = process.argv[2] || "https://slatebaskets.vercel.app";

const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const WIDTH = 428;
const HEIGHT = 926;
const SCALE = 3; // 428*3 = 1284, 926*3 = 2778

const SHOTS = [
  {
    name: "01-market.png",
    path: "/",
    // Wait for real prices rather than the loading skeletons — a screenshot of
    // an empty state is worse than no screenshot.
    ready: () => document.body.innerText.includes("AAPL"),
  },
  {
    name: "02-build.png",
    path: "/create?legs=NVDAc.3500-MSFTc.2500-GOOGLc.2000-METAc.2000&name=AI%20Buildout",
    ready: () => document.body.innerText.includes("NVDA"),
  },
  {
    name: "03-slate.png",
    path: "/s/smplVkfLF_19",
    ready: () => document.body.innerText.includes("Composition"),
  },
];

const outDir = "screenshots";
await mkdir(outDir, { recursive: true });

const profile = join(tmpdir(), `slate-shots-${Date.now()}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  userDataDir: profile,
  args: ["--hide-scrollbars", "--force-color-profile=srgb", "--disable-extensions"],
});

console.log(`\nCapturing ${ORIGIN} at ${WIDTH * SCALE} x ${HEIGHT * SCALE}\n`);

try {
  for (const shot of SHOTS) {
    const page = await browser.newPage();
    await page.setViewport({
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      isMobile: true,
      hasTouch: true,
    });

    await page.goto(ORIGIN + shot.path, { waitUntil: "networkidle2", timeout: 60_000 });

    try {
      await page.waitForFunction(shot.ready, { timeout: 30_000 });
    } catch {
      console.log(`  ! ${shot.name}: content never settled, capturing anyway`);
    }

    if (shot.scrollTo) {
      await page.evaluate((y) => window.scrollTo(0, y), shot.scrollTo);
      // One frame for the scroll to paint before the shutter.
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    // Headless Chrome ghosts a backdrop-filtered fixed bar onto the top of the
    // frame — a compositing artifact that shows up as a smudge in the capture
    // but never on a real device. The blur is decorative, so it comes off for
    // the shutter and the screenshot is otherwise the live app.
    await page.addStyleTag({ content: ".backdrop-blur{backdrop-filter:none !important;}" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const buffer = await page.screenshot({ type: "png" });

    // The viewport is already 1284 x 2778; resize is a guard against a Chrome
    // that rounds the device scale factor rather than a transformation.
    const out = join(outDir, shot.name);
    await sharp(buffer)
      .resize(WIDTH * SCALE, HEIGHT * SCALE, { fit: "cover", position: "top" })
      .png({ compressionLevel: 9 })
      .toFile(out);

    const meta = await sharp(out).metadata();
    console.log(`  ${shot.name.padEnd(18)} ${meta.width}x${meta.height}`);
    await page.close();
  }
} finally {
  await browser.close();
  // Windows keeps a lock on Chrome's crash-metrics file for a moment after
  // exit. Failing to delete a temp profile is not a reason to lose the
  // screenshots that were just captured.
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

// The dashboard's thumbnail slot wants 1.91:1 and the hero is 1200x630
// (1.905:1). 1200x628 lands on 1.9108:1, inside any plausible tolerance.
await sharp("public/hero.png")
  .resize(1200, 628, { fit: "cover", position: "center" })
  .png({ compressionLevel: 9 })
  .toFile(join(outDir, "thumbnail.png"));
console.log(`  ${"thumbnail.png".padEnd(18)} 1200x628`);

console.log(`\nWritten to ./${outDir}\n`);
