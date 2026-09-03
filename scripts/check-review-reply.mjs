/**
 * Checks the App Review reply against the 4000-character limit on the Notes field.
 *
 *   node scripts/check-review-reply.mjs
 *
 * The limit counts spaces and punctuation, and App Store Connect simply refuses anything longer.
 * The first draft came to 6655 characters and had to be cut by a third, which is easier to do
 * against a number than against a scrollbar.
 */
import fs from "fs";

const LIMIT = 4000;
const source = fs.readFileSync("store-assets/review-reply.md", "utf8");
const match = source.match(/\n```\n([\s\S]*?)\n```\n/);

if (!match) {
  console.error("  could not find the reply block in store-assets/review-reply.md");
  process.exit(1);
}

const reply = match[1];
const over = reply.length - LIMIT;
console.log(`  reply: ${reply.length} / ${LIMIT} characters  ${over > 0 ? `OVER by ${over}` : `ok, ${-over} to spare`}`);

// Per section, so the next trim starts where the weight actually is.
for (const part of reply.split(/\n(?=\d\. [A-Z])/)) {
  console.log(`  ${String(part.length).padStart(5)}  ${part.trim().split("\n")[0].slice(0, 46)}`);
}

process.exit(over > 0 ? 1 : 0);
