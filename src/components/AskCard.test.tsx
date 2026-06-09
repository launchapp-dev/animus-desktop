import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AskCard } from "./AskCard";

const singleSpec = JSON.stringify({
  questions: [
    {
      question: "Which approach?",
      header: "Approach",
      multiSelect: false,
      options: [
        { label: "Fast", description: "ship now" },
        { label: "Safe", description: "more checks" },
      ],
    },
  ],
});

const multiSpec = JSON.stringify({
  questions: [
    {
      question: "Pick features",
      multiSelect: true,
      options: [{ label: "A" }, { label: "B" }],
    },
  ],
});

describe("AskCard", () => {
  it("renders the question and its options", () => {
    render(<AskCard raw={singleSpec} interactive onAnswer={() => {}} />);
    expect(screen.getByText("Which approach?")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(screen.getByText("Approach")).toBeInTheDocument();
  });

  it("sends immediately on a single-select option click", async () => {
    const onAnswer = vi.fn();
    render(<AskCard raw={singleSpec} interactive onAnswer={onAnswer} />);
    await userEvent.click(screen.getByText("Fast"));
    expect(onAnswer).toHaveBeenCalledWith("Approach: Fast");
  });

  it("requires Send for multi-select and composes all picks", async () => {
    const onAnswer = vi.fn();
    render(<AskCard raw={multiSpec} interactive onAnswer={onAnswer} />);
    // toggling options should not auto-send
    await userEvent.click(screen.getByText("A"));
    await userEvent.click(screen.getByText("B"));
    expect(onAnswer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Send answer"));
    expect(onAnswer).toHaveBeenCalledWith("Pick features: A, B");
  });

  it("disables options when not interactive", () => {
    render(<AskCard raw={singleSpec} interactive={false} onAnswer={() => {}} />);
    expect(screen.getByText("Fast").closest("button")).toBeDisabled();
  });

  it("falls back to raw display for an unrecognized payload", () => {
    render(<AskCard raw={"not json"} interactive onAnswer={() => {}} />);
    expect(screen.getByText("AskUserQuestion")).toBeInTheDocument();
    expect(screen.getByText("not json")).toBeInTheDocument();
  });
});
