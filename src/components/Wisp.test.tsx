import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Wisp } from "./Wisp";

function svg(container: HTMLElement) {
  return container.querySelector("svg.wisp-svg") as SVGSVGElement;
}

describe("Wisp", () => {
  it("renders an svg with the flame body", () => {
    const { container } = render(<Wisp />);
    const path = container.querySelector("path.wisp__body");
    expect(path).not.toBeNull();
    expect(path!.getAttribute("fill")).toBe("var(--wisp-flame)");
  });

  it("knockout eyes use the surface variable, never a painted hex", () => {
    const { container } = render(<Wisp expression="awake" />);
    const eyes = container.querySelectorAll(".wisp__eye");
    expect(eyes.length).toBeGreaterThan(0);
    eyes.forEach((e) => {
      const fill = e.getAttribute("fill");
      const stroke = e.getAttribute("stroke");
      const paint = fill && fill !== "none" ? fill : stroke;
      expect(paint).toBe("var(--wisp-eye)");
    });
  });

  it("needs-you shows the amber exclamation", () => {
    const { container } = render(<Wisp expression="needs-you" />);
    expect(container.querySelector(".wisp__alert-mark")).not.toBeNull();
  });

  it("auto motion picks breathe for awake and lean for working", () => {
    const a = render(<Wisp expression="awake" motion="auto" />);
    expect(svg(a.container).classList.contains("wisp--breathe")).toBe(true);
    const w = render(<Wisp expression="working" motion="auto" />);
    expect(svg(w.container).querySelector(".wisp__lean")?.classList.contains("wisp--working")).toBe(true);
  });

  it("motion=none renders no animation class", () => {
    const { container } = render(<Wisp expression="awake" motion="none" />);
    const cls = svg(container).getAttribute("class") ?? "";
    expect(cls).not.toMatch(/wisp--/);
  });

  it("mono forces the knockout flame fill", () => {
    const { container } = render(<Wisp mono size={16} />);
    expect(container.querySelector("path.wisp__body")!.getAttribute("fill")).toBe("var(--wisp-mono)");
  });

  it("exposes an accessible label when title is given", () => {
    const { getByRole } = render(<Wisp title="Animus" />);
    expect(getByRole("img", { name: "Animus" })).toBeTruthy();
  });
});
