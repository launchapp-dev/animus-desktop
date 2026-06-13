import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../api/animus", () => ({
  animusSkillList: vi.fn(),
  animusSkillInfo: vi.fn(),
  animusSkillSave: vi.fn(),
  animusSkillDelete: vi.fn(),
  animusSkillInstall: vi.fn(),
  animusSkillUpdate: vi.fn(),
  animusSkillUninstall: vi.fn(),
}));

import { SkillsView } from "./SkillsView";
import {
  animusSkillList,
  animusSkillInfo,
  animusSkillInstall,
  animusSkillUninstall,
  type SkillSummary,
} from "../../api/animus";
import type { Project } from "../../types/contracts";

const project = { id: "p1", repo_path: "/tmp/proj" } as unknown as Project;
const listMock = vi.mocked(animusSkillList);
const infoMock = vi.mocked(animusSkillInfo);
const installMock = vi.mocked(animusSkillInstall);
const uninstallMock = vi.mocked(animusSkillUninstall);

const skills: SkillSummary[] = [
  { name: "acceptance-criteria", description: "Break a requirement down", category: "Planning", source: "installed", type: "definition" },
  { name: "animus-copilot", description: "Desktop ops copilot", category: "Operations", source: "project", type: "definition" },
];

function envOk(data: unknown = null) {
  return { ok: true, data, error: null, rawStderr: "" };
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue({ ok: true, data: skills, error: null, rawStderr: "" });
  infoMock.mockResolvedValue({
    ok: true,
    data: { name: "acceptance-criteria", description: "", category: null, source: "installed" },
    error: null,
    rawStderr: "",
  });
});

describe("SkillsView install + manage", () => {
  it("installs a skill by name", async () => {
    installMock.mockResolvedValue(envOk());
    render(<SkillsView project={project} />);
    await waitFor(() => expect(screen.getByText("acceptance-criteria")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Install skill"));
    await userEvent.type(screen.getByPlaceholderText("acceptance-criteria"), "code-reviewer");
    await userEvent.type(screen.getByPlaceholderText("^1.0.0"), "^2.0.0");
    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => expect(installMock).toHaveBeenCalled());
    expect(installMock).toHaveBeenCalledWith({
      path: "/tmp/proj",
      name: "code-reviewer",
      version: "^2.0.0",
      localPath: undefined,
    });
  });

  it("offers Update and Uninstall on installed-scope skills", async () => {
    uninstallMock.mockResolvedValue(envOk());
    render(<SkillsView project={project} />);
    await waitFor(() => expect(screen.getByText("acceptance-criteria")).toBeInTheDocument());

    await userEvent.click(screen.getByText("acceptance-criteria"));
    await waitFor(() => expect(screen.getByText("Update")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Uninstall"));
    await userEvent.click(screen.getByText("Confirm uninstall"));

    await waitFor(() => expect(uninstallMock).toHaveBeenCalledWith("/tmp/proj", "acceptance-criteria"));
  });
});
