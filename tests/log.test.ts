import { describe, expect, it } from "vitest";
import { logRequestsRerun, parseLatexLog } from "../src/core/log";

describe("LaTeX log parser", () => {
  it("parses file-line errors", () => {
    const result = parseLatexLog("chapter.tex:42: Undefined control sequence.");
    expect(result[0]).toMatchObject({
      severity: "error",
      line: 42,
      message: "Undefined control sequence."
    });
  });

  it("parses classic TeX errors with following line numbers", () => {
    const result = parseLatexLog("! Missing $ inserted.\nl.17 broken");
    expect(result[0]).toMatchObject({ severity: "error", line: 17 });
  });

  it("recognizes rerun requests", () => {
    expect(logRequestsRerun("LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.")).toBe(true);
  });
});
