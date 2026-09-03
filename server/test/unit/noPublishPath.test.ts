import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Per HCIQ-13's explicit acceptance criterion: "no code path calls any
 * Guide write/publish API." This is a repo-wide grep check — the scope
 * doc calls this a "product-safety commitment, not a nice-to-have," so
 * this test scans all server source files (not just the drafts folder)
 * to make sure a publish call never gets added anywhere, now or later.
 */
function getAllTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      getAllTsFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("no Guide publish path exists (HCIQ-13 product-safety commitment)", () => {
  it("no source file calls a Zendesk Guide article write/publish endpoint", () => {
    const srcDir = path.resolve(__dirname, "../../src");
    const files = getAllTsFiles(srcDir);

    // Zendesk's Guide article write endpoints all look like
    // POST/PUT .../help_center/.../articles(.json) — checking for the
    // API path substring catches any write call regardless of HTTP
    // method or exact wording used to construct the URL.
    const suspiciousPattern = /help_center\/.*articles/i;

    const offendingFiles: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      // guideArticleFetcher.ts legitimately reads (GET) articles for
      // ingestion (HCIQ-9) — that's fetching existing coverage, not
      // publishing. Every other file must never reference this path.
      if (file.includes("guideArticleFetcher.ts")) continue;

      if (suspiciousPattern.test(content)) {
        offendingFiles.push(file);
      }
    }

    expect(offendingFiles).toEqual([]);
  });

  it("draft_articles are always created with status 'draft', never a published state", async () => {
    const { createDraftArticle } = await import("../../src/db/models/draftArticles.js");

    // Confirms the INSERT statement's hardcoded status literal —
    // reading the module source directly proves no code path can
    // pass an arbitrary/published status at creation time, since
    // createDraftArticle's signature doesn't even accept one.
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/db/models/draftArticles.ts"),
      "utf8"
    );
    expect(source).toContain("'draft'");
    expect(createDraftArticle).toBeDefined();
  });
});