import { Check, ExternalLink } from "lucide-react";

import { cn } from "../lib/utils";
import type { Plugin } from "../types/contracts";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface PluginCardProps {
  plugin: Plugin;
  onInstall?: (plugin: Plugin) => void | Promise<void>;
  busy?: boolean;
}

function kindLabel(kind: string): string {
  if (!kind) return "plugin";
  return kind.replace(/_/g, " ");
}

export function PluginCard({ plugin, onInstall, busy }: PluginCardProps) {
  const repoUrl = plugin.repo?.includes("/")
    ? `https://github.com/${plugin.repo}`
    : null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-border bg-bg-elevated px-3 py-2.5",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-text">
            {plugin.name}
          </span>
          <Badge variant="neutral" className="font-mono text-[10px]">
            {kindLabel(plugin.kind)}
          </Badge>
          {plugin.version && (
            <span className="font-mono text-[11px] text-text-faint">
              v{plugin.version}
            </span>
          )}
        </div>
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent"
          >
            <ExternalLink className="h-3 w-3" />
            View source
          </a>
        )}
      </div>
      <div className="shrink-0">
        {plugin.installed ? (
          <Badge variant="passed" className="gap-1">
            <Check className="h-3 w-3" />
            Installed
          </Badge>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onInstall?.(plugin)}
          >
            {busy ? "Installing…" : "Install"}
          </Button>
        )}
      </div>
    </div>
  );
}
