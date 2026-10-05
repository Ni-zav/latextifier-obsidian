import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectCompiler } from "../src/core/compiler";
import { forwardSearch, inverseSearch } from "../src/core/synctex";
import type { BuildResult, Engine, LatextifierSettings } from "../src/types";

const roots: string[] = [];
const enabled = process.env.LATEXTIFIER_TEX_INTEGRATION === "1";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe.skipIf(!enabled)("real TeX integration", () => {
  for (const engine of ["pdflatex", "xelatex", "lualatex"] as const) {
    it("compiles the multi-file fixture with " + engine, async () => {
      const fixture = await fixtureCopy();
      const result = await compile(join(fixture, "main.tex"), engine, "fast");

      expect(result.ok).toBe(true);
      expect(result.pdfData?.byteLength ?? 0).toBeGreaterThan(1000);
      expect([...result.dependencies].some((file) => file.endsWith("chapter.tex"))).toBe(true);
    }, 120_000);
  }

  it("runs latexmk full build and resolves bibliography", async () => {
    const fixture = await fixtureCopy();
    const result = await compile(join(fixture, "main.tex"), "pdflatex", "full");

    expect(result.ok).toBe(true);
    expect(result.rawLog.includes("undefined citations")).toBe(false);
    expect(result.pdfData?.byteLength ?? 0).toBeGreaterThan(1000);
  }, 120_000);

  it("round-trips source and PDF locations through SyncTeX", async () => {
    const fixture = await fixtureCopy();
    const chapter = join(fixture, "chapter.tex");
    const result = await compile(join(fixture, "main.tex"), "pdflatex", "full");

    expect(result.ok).toBe(true);
    const box = await forwardSearch("", "", result.pdfPath, chapter, 5, 0);
    expect(box).not.toBeNull();
    if (!box) return;

    const location = await inverseSearch("", "", result.pdfPath, box.page, box.x, box.y, fixture);
    expect(location).not.toBeNull();
    expect(location?.line ?? 0).toBeGreaterThan(0);
  }, 120_000);
});

async function fixtureCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "latextifier-tex-"));
  roots.push(root);
  await cp(join(process.cwd(), "tests/fixtures/tex-project"), root, { recursive: true });
  return root;
}

async function compile(root: string, engine: Engine, mode: "fast" | "full"): Promise<BuildResult> {
  const settings: LatextifierSettings = {
    compileDebounceMs: 100,
    autoCompile: false,
    defaultEngine: engine,
    fragmentEngine: "pdflatex",
    texBinDir: "",
    latexmkPath: "",
    synctexPath: "",
    dvisvgmPath: "",
    fragmentPreamble: "",
    previewVisibleByDefault: true,
    continuousSyncByDefault: true,
    navigatorVisibleByDefault: true,
    autoCloseEnvironment: true,
    autoContinueItems: true,
    enableTexlab: false,
    texlabPath: "",
    allowShellEscape: false
  };

  return await new Promise<BuildResult>((resolvePromise, rejectPromise) => {
    const compiler = new ProjectCompiler(root, () => settings, {
      onStart: () => undefined,
      onResult: (result) => {
        compiler.dispose();
        resolvePromise(result);
      },
      onFailure: (error) => {
        compiler.dispose();
        rejectPromise(error);
      }
    });
    compiler.request(mode);
  });
}
