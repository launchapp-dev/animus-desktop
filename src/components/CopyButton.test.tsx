import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const writeText = vi.fn((_text: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (t: string) => writeText(t),
}));

import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  beforeEach(() => writeText.mockClear());

  it("renders nothing when there is no text", () => {
    const { container } = render(<CopyButton text="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("copies the text to the clipboard on click", async () => {
    render(<CopyButton text="hello world" />);
    const btn = screen.getByTitle("Copy");
    await userEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("hello world"));
  });

  it("applies an extra className", () => {
    render(<CopyButton text="x" className="cx-copy--agent" />);
    expect(screen.getByTitle("Copy")).toHaveClass("cx-copy--agent");
  });
});
