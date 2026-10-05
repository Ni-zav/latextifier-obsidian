import { describe, expect, it } from "vitest";
import { containsDocumentClass, detectEngine, parseTexDirectives } from "../src/core/project";

describe("TeX project metadata", () => {
  it("parses root and engine magic comments", () => {
    const source = "% !TEX root = ../main.tex\n% !TEX program = xelatex\n";
    expect(parseTexDirectives(source)).toEqual({ root: "../main.tex", program: "xelatex" });
  });

  it("detects document roots", () => {
    expect(containsDocumentClass("\\documentclass{article}")).toBe(true);
    expect(containsDocumentClass("\\section{Chapter}")).toBe(false);
  });

  it("detects common engine requirements", () => {
    expect(detectEngine("\\usepackage{fontspec}", "pdflatex")).toBe("xelatex");
    expect(detectEngine("\\directlua{tex.print(\"x\")}", "pdflatex")).toBe("lualatex");
    expect(detectEngine("plain", "pdflatex")).toBe("pdflatex");
  });
});
