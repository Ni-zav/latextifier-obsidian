import { describe, expect, it } from "vitest";
import { classifyFragment, requestedFragmentMode, stripFragmentDirective } from "../src/markdown/classifier";

describe("Markdown fragment classifier", () => {
  it("keeps ordinary display math on the fast path", () => {
    expect(classifyFragment("\\begin{align} E &= mc^2 \\end{align}")).toBe("math");
  });

  it("escalates TikZ to a real TeX build", () => {
    expect(classifyFragment("\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}")).toBe("tex");
  });

  it("honors explicit directives", () => {
    const source = "% latextifier: math\n\\begin{tikzpicture}x\\end{tikzpicture}";
    expect(requestedFragmentMode(source)).toBe("math");
    expect(classifyFragment(source)).toBe("math");
    expect(stripFragmentDirective(source)).not.toContain("latextifier:");
  });
});
