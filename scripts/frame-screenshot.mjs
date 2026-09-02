/**
 * Frames a screenshot onto a 2880x1800 canvas for App Store Connect.
 *
 *   node scripts/frame-screenshot.mjs <input.png> <output.png> ["Caption"]
 *
 * Exists because the Flow Search screenshot cannot be generated the way the others are. The
 * extension's own pages are captured directly from the running extension, but Flow Search lives
 * inside Salesforce Setup, and the only fixture for that is the deliberately crude one the tests
 * use. Drawing a convincing fake of Setup and putting it on a store listing is not an option, so
 * that one screenshot is a real capture from a real org -- which arrives at whatever size the
 * window happened to be, and App Store Connect only accepts a fixed set of sizes.
 *
 * The backdrop is the extension's own dark ground, so the framed shot sits with the others.
 */
import {chromium} from "@playwright/test";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter(a => a.startsWith("--"))
    .map(a => a.replace(/^--/, "").split("="))
    .map(([k, v]) => [k, Number(v) || 0])
);
const [input, output, caption] = args.filter(a => !a.startsWith("--"));
if (!input || !output) {
  console.error("usage: node scripts/frame-screenshot.mjs [--crop-top=N --crop-right=N --crop-bottom=N --crop-left=N] <input.png> <output.png> [\"Caption\"]");
  process.exit(1);
}
const crop = {
  top: flags["crop-top"] || 0,
  right: flags["crop-right"] || 0,
  bottom: flags["crop-bottom"] || 0,
  left: flags["crop-left"] || 0
};
if (!fs.existsSync(input)) {
  console.error(`no such file: ${input}`);
  process.exit(1);
}

const WIDTH = 2880;
const HEIGHT = 1800;
const b64 = fs.readFileSync(input).toString("base64");
const mime = path.extname(input).toLowerCase() === ".jpg" ? "image/jpeg" : "image/png";

const browser = await chromium.launch({args: ["--force-color-profile=srgb"]});
const page = await browser.newPage({
  viewport: {width: WIDTH / 2, height: HEIGHT / 2},
  deviceScaleFactor: 2
});

await page.setContent(`<!doctype html>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body {
    /* The theme's dark ground, so this sits with the captured screenshots. */
    background-color: #16161a;
    background-image:
      radial-gradient(at 12% 8%,  rgba(88, 60, 140, .34) 0px, transparent 55%),
      radial-gradient(at 88% 12%, rgba(140, 60, 90, .26) 0px, transparent 50%),
      radial-gradient(at 78% 88%, rgba(40, 80, 140, .28) 0px, transparent 55%),
      radial-gradient(at 20% 92%, rgba(60, 120, 130, .20) 0px, transparent 50%);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 26px;
    font: 500 21px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #f2f2f7;
  }
  figure {
    /* Fit inside the canvas with a margin, keeping the shot's own aspect ratio. */
    max-width: 1290px; max-height: ${caption ? 770 : 810}px;
    display: flex;
  }
  img, canvas {
    max-width: 100%; max-height: 100%;
    object-fit: contain;
    border-radius: 12px;
    box-shadow:
      0 30px 60px rgba(0, 0, 0, .55),
      0 0 0 1px rgba(255, 255, 255, .10);
  }
  figcaption { letter-spacing: .01em; opacity: .92; text-align: center; }
</style>
<figure><img src="data:${mime};base64,${b64}"></figure>
${caption ? `<figcaption>${caption}</figcaption>` : ""}`);

await page.waitForFunction(() => {
  const img = document.querySelector("img");
  return img && img.complete && img.naturalWidth > 0;
});

// Cropping happens on a canvas rather than with overflow tricks, so the framed element really is
// the cropped region -- the fit, the rounded corner and the shadow then all apply to it, instead
// of to a box with the unwanted strip hidden behind it.
if (crop.top || crop.right || crop.bottom || crop.left) {
  const cropped = await page.evaluate(box => {
    const img = document.querySelector("img");
    const width = img.naturalWidth - box.left - box.right;
    const height = img.naturalHeight - box.top - box.bottom;
    if (width <= 0 || height <= 0) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(img, box.left, box.top, width, height, 0, 0, width, height);
    img.replaceWith(canvas);
    return {width, height};
  }, crop);
  if (!cropped) {
    console.error("  crop removes the whole image");
    process.exit(1);
  }
  console.log(`  cropped to ${cropped.width}x${cropped.height}`);
}
await page.screenshot({path: output});
await browser.close();

console.log(`  ${input} -> ${output}  (${WIDTH}x${HEIGHT})`);
