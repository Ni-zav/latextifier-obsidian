import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { exportPortableProjectHtml } from "../src/core/export-html";
import type { ProjectSnapshot } from "../src/core/project-index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("portable project export", () => {
  it("writes a self-contained escaped HTML project snapshot", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "latextifier-export-"));
    roots.push(rootDir);
    const root = join(rootDir, "main.tex");
    await writeFile(root, "\\section{Hello}\n<unsafe>&\n", "utf8");

    const snapshot: ProjectSnapshot = {
      root,
      preamble: "",
      files: [root],
      bibFiles: [],
      packages: [],
      labels: [{ key: "sec:hello", file: root, line: 1, column: 0 }],
      citations: [],
      commands: [],
      environments: [],
      references: [{ from: "file:main.tex", to: "sec:hello", kind: "ref", file: root, line: 1, column: 0 }],
      outline: [{ kind: "section", title: "Hello", level: 2, file: root, line: 1, column: 0 }],
      todos: [{ text: "Check export", file: root, line: 2, column: 0 }],
      updatedAt: Date.now()
    };

    const result = await exportPortableProjectHtml(snapshot, new Uint8Array([37, 80, 68, 70]));
    const html = await readFile(result.path, "utf8");

    expect(html).toContain("data:application/pdf;base64,");
    expect(html).toContain("&lt;unsafe&gt;&amp;");
    expect(html).toContain("Check export");
    expect(html).toContain("sec:hello");
    expect(html).not.toContain("<script");
    expect(result.bytes).toBeGreaterThan(1000);
  });
});
