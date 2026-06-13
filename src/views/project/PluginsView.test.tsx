import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../api/_invoke", () => ({
  pluginList: vi.fn(),
  pluginInstall: vi.fn(),
}));
vi.mock("../../api/animus", () => ({
  animusFlavorCurrent: vi.fn(),
}));

import { PluginsView } from "./PluginsView";
import { pluginList, pluginInstall } from "../../api/_invoke";
import { animusFlavorCurrent, type FlavorCurrent } from "../../api/animus";
import type { Plugin, Project } from "../../types/contracts";

const project = { id: "p1", repo_path: "/tmp/proj" } as unknown as Project;
const listMock = vi.mocked(pluginList);
const installMock = vi.mocked(pluginInstall);
const flavorMock = vi.mocked(animusFlavorCurrent);

const flavor: FlavorCurrent = {
  name: "default",
  source: "default",
  installed: true,
  drift: [],
  manifest: {
    id: "default",
    version: "0.5.0",
    title: "Animus Default",
    description: "Curated bundle for solo founders.",
    providers: {
      required: ["launchapp-dev/animus-provider-claude"],
      recommended: ["launchapp-dev/animus-provider-codex"],
    },
    subjects: {
      required: ["launchapp-dev/animus-subject-default"],
      recommended: [],
    },
  },
};

function flavorOk(data: FlavorCurrent) {
  return { ok: true, data, error: null, rawStderr: "" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PluginsView (flavor runtime)", () => {
  it("shows the flavor, required plugins, and a missing-install action", async () => {
    flavorMock.mockResolvedValue(flavorOk(flavor));
    // claude installed, subject-default NOT installed → one gap.
    listMock.mockResolvedValue([
      { name: "animus-provider-claude", kind: "provider", version: "1", repo: "", installed: true },
    ] as Plugin[]);

    render(<PluginsView project={project} />);

    await waitFor(() => expect(screen.getByText("Animus Default")).toBeInTheDocument());
    expect(screen.getByText("animus-provider-claude")).toBeInTheDocument();
    expect(screen.getByText("animus-subject-default")).toBeInTheDocument();
    expect(screen.getByText("1 required missing")).toBeInTheDocument();
    expect(screen.getByText(/Install 1 missing/)).toBeInTheDocument();
  });

  it("reports runtime ready when all required are installed", async () => {
    flavorMock.mockResolvedValue(flavorOk(flavor));
    listMock.mockResolvedValue([
      { name: "animus-provider-claude", kind: "provider", version: "1", repo: "", installed: true },
      { name: "animus-subject-default", kind: "subject_backend", version: "1", repo: "", installed: true },
    ] as Plugin[]);

    render(<PluginsView project={project} />);
    await waitFor(() => expect(screen.getByText("Runtime ready")).toBeInTheDocument());
    expect(screen.queryByText(/Install .* missing/)).toBeNull();
  });

  it("keeps recommended collapsed until expanded", async () => {
    flavorMock.mockResolvedValue(flavorOk(flavor));
    listMock.mockResolvedValue([] as Plugin[]);

    render(<PluginsView project={project} />);
    await waitFor(() => expect(screen.getByText("Animus Default")).toBeInTheDocument());

    expect(screen.queryByText("animus-provider-codex")).toBeNull();
    await userEvent.click(screen.getByText("Recommended"));
    expect(screen.getByText("animus-provider-codex")).toBeInTheDocument();
  });

  it("installs a flavor plugin by its repo-qualified slug", async () => {
    flavorMock.mockResolvedValue(flavorOk(flavor));
    listMock.mockResolvedValue([
      { name: "animus-provider-claude", kind: "provider", version: "1", repo: "", installed: true },
    ] as Plugin[]);
    installMock.mockResolvedValue(undefined as never);

    render(<PluginsView project={project} />);
    await waitFor(() => expect(screen.getByText("animus-subject-default")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => expect(installMock).toHaveBeenCalledWith("launchapp-dev/animus-subject-default"));
  });
});
