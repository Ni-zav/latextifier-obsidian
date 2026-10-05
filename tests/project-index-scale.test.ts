import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectIndex } from "../src/core/project-index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ProjectIndex scale and invalidation", () => {
  it("indexes a large include graph and observes changed files on refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "latextifier-scale-"));
    roots.push(root);

    const includes: string[] = [];
    for (let index = 0; index < 140; index += 1) {
      const stem = "chapter-" + String(index);
      includes.push("\\input{" + stem + "}");
      await writeFile(
        join(root, stem + ".tex"),
        "\\section{Chapter " + String(index) + "}\n\\label{sec:" + String(index) + "}\n",
        "utf8"
      );
    }
    await writeFile(
      join(root, "main.tex"),
      "\\documentclass{article}\n\\begin{document}\n" + includes.join("\n") + "\n\\end{document}\n",
      "utf8"
    );

    const index = new ProjectIndex(join(root, "main.tex"));
    const first = await index.refresh();
    expect(first.files).toHaveLength(141);
    expect(first.labels).toHaveLength(140);

    await writeFile(
      join(root, "chapter-79.tex"),
      "\\section{Chapter 79}\n\\label{sec:79}\n\\label{sec:changed}\n",
      "utf8"
    );
    const second = await index.refresh();
    expect(second.files).toHaveLength(141);
    expect(second.labels.some((item) => item.key === "sec:changed")).toBe(true);
  }, 15_000);
});
