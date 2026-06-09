import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView } from "./DiffView";

describe("DiffView", () => {
  it("colors added, removed, hunk, and context lines", () => {
    const diff = `@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;`;
    render(<DiffView text={diff} />);
    const pre = screen.getByTestId("diff-view");
    const cls = Array.from(pre.querySelectorAll("div")).map((d) => d.className);
    expect(cls).toContain("cx-diff__line cx-diff__line--hunk");
    expect(cls).toContain("cx-diff__line cx-diff__line--del");
    expect(cls).toContain("cx-diff__line cx-diff__line--add");
    expect(cls).toContain("cx-diff__line cx-diff__line--ctx");
  });

  it("renders one div per line and preserves blank lines", () => {
    render(<DiffView text={"+a\n\n+b"} />);
    const divs = screen.getByTestId("diff-view").querySelectorAll("div");
    expect(divs).toHaveLength(3);
  });
});
