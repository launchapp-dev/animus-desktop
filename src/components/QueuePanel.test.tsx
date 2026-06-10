import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueuePanel } from "./QueuePanel";

describe("QueuePanel", () => {
  it("renders nothing when the queue is empty", () => {
    const { container } = render(
      <QueuePanel queue={[]} paused={false} onRemove={() => {}} onResume={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders queued messages in FIFO order", () => {
    render(
      <QueuePanel
        queue={["first message", "second message"]}
        paused={false}
        onRemove={() => {}}
        onResume={() => {}}
      />,
    );
    const items = screen
      .getByTestId("queue-panel")
      .querySelectorAll(".cx-queue__text");
    expect(Array.from(items).map((n) => n.textContent)).toEqual([
      "first message",
      "second message",
    ]);
    expect(screen.getByText(/sends when the agent is free/)).toBeInTheDocument();
    expect(screen.queryByText("▶ resume")).toBeNull();
  });

  it("removes the right item by index", async () => {
    const onRemove = vi.fn();
    render(
      <QueuePanel
        queue={["a", "b", "c"]}
        paused={false}
        onRemove={onRemove}
        onResume={() => {}}
      />,
    );
    const removeButtons = screen.getAllByTitle("Remove");
    await userEvent.click(removeButtons[1]!);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("shows the paused state with a working resume button", async () => {
    const onResume = vi.fn();
    render(
      <QueuePanel queue={["x"]} paused onRemove={() => {}} onResume={onResume} />,
    );
    expect(screen.getByText(/Queue paused/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("▶ resume"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
