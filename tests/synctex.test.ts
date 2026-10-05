import { describe, expect, it } from "vitest";
import { parseSyncTexEdit, parseSyncTexView } from "../src/core/synctex";

describe("SyncTeX parsing", () => {
  it("parses forward-search boxes", () => {
    const box = parseSyncTexView(
      "Output:test.pdf\nPage:3\nh:120.5\nv:200\nW:80\nH:12\n"
    );
    expect(box).toEqual({ page: 3, x: 120.5, y: 188, width: 80, height: 12 });
  });

  it("parses inverse-search locations", () => {
    const location = parseSyncTexEdit("Output:test.tex\nInput:chapters/a.tex\nLine:27\nColumn:4\n", "/project");
    expect(location?.line).toBe(27);
    expect(location?.column).toBe(4);
    expect(location?.file.replaceAll("\\\\", "/")).toContain("/project/chapters/a.tex");
  });
});
