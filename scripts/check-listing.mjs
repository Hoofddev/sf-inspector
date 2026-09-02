/**
 * Checks store-assets/listing.md against the field limits App Store Connect enforces.
 *
 *   node scripts/check-listing.mjs
 *
 * The limits are counted in characters, and App Store Connect simply refuses anything longer --
 * so a subtitle one character over is found here rather than after a paste into the web form.
 */
import fs from "fs";

const LIMITS = {
  "Name": 30,
  "Subtitle": 30,
  "Promotional text": 170,
  "Keywords": 100,
  "Description": 4000,
  "What's New in This Version": 4000
};

const source = fs.readFileSync("store-assets/listing.md", "utf8");
let failed = false;

for (const [field, limit] of Object.entries(LIMITS)) {
  // The heading, then the first fenced block under it.
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`## ${escaped}[^\\n]*\\n+\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
  if (!match) {
    console.log(`  ${field.padEnd(28)} NOT FOUND`);
    failed = true;
    continue;
  }
  const value = match[1].trim();
  const over = value.length > limit;
  failed = failed || over;
  const state = over ? `OVER by ${value.length - limit}` : "ok";
  console.log(`  ${field.padEnd(28)} ${String(value.length).padStart(4)} / ${String(limit).padEnd(4)}  ${state}`);
}

// Keywords are comma-separated with no spaces; a stray space costs a character for nothing.
const keywords = source.match(/## Keywords[^\n]*\n+```\n([\s\S]*?)\n```/);
if (keywords && /,\s/.test(keywords[1])) {
  console.log("  keywords contain a space after a comma, which wastes characters");
  failed = true;
}

process.exit(failed ? 1 : 0);
