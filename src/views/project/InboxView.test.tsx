import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../api/animus", () => ({
  animusInteractionsList: vi.fn(),
  animusInteractionsAnswer: vi.fn(),
}));

import { InboxView } from "./InboxView";
import {
  animusInteractionsList,
  animusInteractionsAnswer,
  type InteractionRecord,
} from "../../api/animus";
import type { Project } from "../../types/contracts";

const project = { id: "p1", repo_path: "/tmp/proj" } as unknown as Project;

const listMock = vi.mocked(animusInteractionsList);
const answerMock = vi.mocked(animusInteractionsAnswer);

function ok(records: InteractionRecord[]) {
  return { ok: true, data: { interactions: records }, error: null, rawStderr: "" };
}

const structuredQuestion: InteractionRecord = {
  id: "int-1",
  kind: "question",
  agent_id: "swe",
  created_at: new Date().toISOString(),
  status: "pending",
  questions: [
    {
      question: "Which database?",
      header: "Storage",
      options: [{ label: "Postgres" }, { label: "SQLite", description: "embedded" }],
      multi_select: false,
    },
  ],
};

const approval: InteractionRecord = {
  id: "int-2",
  kind: "approval",
  agent_id: "devops",
  created_at: new Date().toISOString(),
  status: "pending",
  action: "use tool Bash",
  tool_name: "Bash",
  arguments: { command: "rm -rf build" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InboxView", () => {
  it("shows the unsupported hint when the CLI lacks the interactions verbs", async () => {
    listMock.mockRejectedValue(
      new Error("animus returned no stdout (status=Some(2), stderr=error: unrecognized subcommand 'interactions')"),
    );
    render(<InboxView project={project} />);
    await waitFor(() =>
      expect(screen.getByText(/needs a newer animus CLI/i)).toBeInTheDocument(),
    );
  });

  it("answers a structured question via --select", async () => {
    listMock.mockResolvedValue(ok([structuredQuestion]));
    answerMock.mockResolvedValue({ ok: true, data: null, error: null, rawStderr: "" });
    render(<InboxView project={project} />);

    await waitFor(() => expect(screen.getByText("Which database?")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Postgres"));
    await userEvent.click(screen.getByText("Send answer"));

    await waitFor(() => expect(answerMock).toHaveBeenCalled());
    expect(answerMock).toHaveBeenCalledWith({
      path: "/tmp/proj",
      id: "int-1",
      selects: ["Which database?=Postgres"],
    });
  });

  it("renders an approval with its arguments and sends allow", async () => {
    listMock.mockResolvedValue(ok([approval]));
    answerMock.mockResolvedValue({ ok: true, data: null, error: null, rawStderr: "" });
    render(<InboxView project={project} />);

    await waitFor(() => expect(screen.getByText("use tool Bash")).toBeInTheDocument());
    expect(screen.getByText(/rm -rf build/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Allow"));

    await waitFor(() => expect(answerMock).toHaveBeenCalled());
    expect(answerMock).toHaveBeenCalledWith({
      path: "/tmp/proj",
      id: "int-2",
      decision: "allow",
      message: undefined,
    });
  });

  it("shows the empty state when nothing is pending", async () => {
    listMock.mockResolvedValue(ok([]));
    render(<InboxView project={project} />);
    await waitFor(() =>
      expect(screen.getByText(/No pending interactions/i)).toBeInTheDocument(),
    );
  });
});
