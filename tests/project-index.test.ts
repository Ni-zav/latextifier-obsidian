import { mkdtemp, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectIndex, searchProjectText } from "../src/core/project-index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ProjectIndex", () => {
  it("indexes includes, outline, labels, bibliography, and TODOs", async () => {
    const root = await mkdtemp(join(tmpdir(), "latextifier-index-"));
    roots.push(root);
    await cp(join(process.cwd(), "tests/fixtures/tex-project"), root, { recursive: true });

    const index = new ProjectIndex(join(root, "main.tex"));
    const snapshot = await index.refresh();

    expect(snapshot.files.some((file) => file.endsWith("main.tex"))).toBe(true);
    expect(snapshot.files.some((file) => file.endsWith("chapter.tex"))).toBe(true);
    expect(snapshot.bibFiles.some((file) => file.endsWith("refs.bib"))).toBe(true);
    expect(snapshot.labels.map((item) => item.key)).toContain("eq:einstein");
    expect(snapshot.citations.map((item) => item.key)).toContain("knuth1984texbook");
    expect(snapshot.outline.some((item) => item.title === "Integration")).toBe(true);
    expect(snapshot.todos.some((item) => item.text.includes("verify project index"))).toBe(true);

    const hits = await searchProjectText(snapshot, "Einstein");
    expect(hits.some((item) => item.file.endsWith("chapter.tex"))).toBe(true);
  });
});
