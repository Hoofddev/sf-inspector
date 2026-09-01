import {test, expect} from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * The three manifests have to agree about what the extension is made of.
 *
 * manifest.json is not the one that ships everywhere: the release build swaps in
 * manifest-safari.json or manifest-firefox.json, each of which repeats the whole declaration. A
 * file added to only one of them is copied into the bundle and then never runs -- which is silent,
 * because the file is present and looks installed. It cost a full round trip through a build, an
 * install and a page reload to find that a content script had shipped unregistered.
 *
 * This does not require the manifests to be identical. They differ on purpose: Firefox is still
 * manifest v2, and Safari carries an extra content script for the OAuth callback that the others
 * have no use for. What it does require is that the scripts and stylesheets which run on Salesforce
 * pages are the same set in all three.
 */
test.describe("Manifests", () => {
  // eslint-disable-next-line no-undef
  const addon = path.join(process.cwd(), "addon");

  const read = name => JSON.parse(fs.readFileSync(path.join(addon, name), "utf8"));

  /** The entry that runs on Salesforce itself, identified by what it matches rather than by index. */
  const salesforceEntry = manifest => manifest.content_scripts
    .find(entry => entry.matches.some(pattern => pattern.includes("salesforce.com")));

  const PLATFORMS = ["manifest-safari.json", "manifest-firefox.json"];

  for (const platform of PLATFORMS) {
    test(`${platform} runs the same content scripts on Salesforce as manifest.json`, () => {
      const base = salesforceEntry(read("manifest.json"));
      const other = salesforceEntry(read(platform));

      expect(other, `${platform} has no content_scripts entry matching salesforce.com`).toBeTruthy();
      expect(other.js, `${platform} js differs from manifest.json`).toEqual(base.js);
      expect(other.css, `${platform} css differs from manifest.json`).toEqual(base.css);
    });
  }

  test("every declared content script and stylesheet exists", () => {
    for (const name of ["manifest.json", ...PLATFORMS]) {
      const manifest = read(name);
      for (const entry of manifest.content_scripts) {
        for (const file of [...(entry.js || []), ...(entry.css || [])]) {
          expect(fs.existsSync(path.join(addon, file)), `${name} declares ${file}, which is missing`).toBe(true);
        }
      }
    }
  });
});
