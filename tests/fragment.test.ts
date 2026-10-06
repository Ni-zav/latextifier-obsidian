import { describe, expect, it } from "vitest";
import { wrapFragment, wrapFragmentFallback } from "../src/markdown/fragment-compiler";

describe("fragment wrapper", () => {
  it("creates a valid standalone document", () => {
    const result = wrapFragment("\\frac{a}{b}", "");
    expect(result).toContain("\\documentclass[preview,border=2pt]{standalone}");
    expect(result).toContain("\\usepackage{amsmath,amssymb}");
    expect(result).toContain("\\begin{document}");
    expect(result).toContain("\\end{document}");
    expect(result).not.toContain("\\\\documentclass");
  });

  it("adds common packages only when needed", () => {
    expect(wrapFragment("\\begin{tikzpicture}\\end{tikzpicture}", "")).toContain("\\usepackage{tikz}");
    expect(wrapFragment("\\toprule", "")).toContain("\\usepackage{booktabs}");
  });

  it("provides a plain article fallback without standalone.cls", () => {
    const result = wrapFragmentFallback("\\frac{a}{b}", "");
    expect(result).toContain("\\documentclass{article}");
    expect(result).not.toContain("standalone");
  });

  it("does not wrap complete documents", () => {
    const source = "\\documentclass{article}\\begin{document}Hi\\end{document}";
    expect(wrapFragment(source, "")).toBe(source);
  });
});
