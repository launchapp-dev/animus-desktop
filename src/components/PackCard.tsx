import {
  Calendar,
  ClipboardCheck,
  GitPullRequest,
  LifeBuoy,
  ListTodo,
  Megaphone,
  MessageSquareCode,
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";

import type { PackMeta } from "../data/packs";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  GitPullRequest,
  MessageSquareCode,
  ListTodo,
  LifeBuoy,
  TrendingUp,
  Users,
  Megaphone,
  ShoppingCart,
  Calendar,
  ClipboardCheck,
  Package,
};

interface PackCardProps {
  pack: PackMeta;
  selected?: boolean;
  onSelect?: (pack: PackMeta) => void;
}

export function PackCard({ pack, selected = false, onSelect }: PackCardProps) {
  const Icon = pack.icon ? ICONS[pack.icon] ?? Package : Package;

  const card = (
    <button
      type="button"
      onClick={() => pack.enabled && onSelect?.(pack)}
      disabled={!pack.enabled}
      className={cn(
        "group relative flex h-full w-full flex-col gap-2 rounded-md border border-border bg-bg-elevated p-4 text-left transition-colors",
        pack.enabled && "hover:border-border-strong hover:bg-bg-hover",
        pack.enabled && selected && "border-accent bg-accent-bg",
        !pack.enabled && "opacity-60 cursor-not-allowed",
      )}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-raised text-text-muted",
            pack.enabled && selected && "border-accent text-accent",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        {!pack.enabled && (
          <Badge variant="warn" className="text-[10px] uppercase tracking-wider">
            Coming soon
          </Badge>
        )}
        {pack.enabled && selected && (
          <Badge variant="info" className="text-[10px] uppercase tracking-wider">
            Selected
          </Badge>
        )}
      </div>
      <div className="text-sm font-semibold text-text">{pack.title}</div>
      <div className="text-xs leading-snug text-text-muted">
        {pack.description}
      </div>
    </button>
  );

  if (pack.enabled) return card;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block h-full w-full">{card}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          The v1 launch lighthouse is CI/CD. Other packs ship as templates land.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
