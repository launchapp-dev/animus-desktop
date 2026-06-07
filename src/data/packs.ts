export interface PackMeta {
  /** Pack id as installed via `animus pack install` (or `ci-cd` for v1). */
  id: string;
  /** Title shown on the card. */
  title: string;
  /** One-line description shown on the card. */
  description: string;
  /** Whether this pack is fully wired in v1. */
  enabled: boolean;
  /** Whether this pack should be hidden from the picker entirely. */
  hidden?: boolean;
  /** Short icon glyph (lucide name). */
  icon?: string;
}

/**
 * The 11 workflow packs surfaced in AddProjectFlow. CI/CD is the launch
 * lighthouse and the only fully-wired pack in v1; the rest render as
 * disabled "Coming soon" cards (per docs/PLUGIN-ECOSYSTEM.md).
 */
export const PACKS: PackMeta[] = [
  {
    id: "ci-cd",
    title: "CI/CD",
    description:
      "Lint, test, build, and status checks on every PR. The launch lighthouse.",
    enabled: true,
    icon: "GitPullRequest",
  },
  {
    id: "animus.review",
    title: "Code review",
    description: "AI reviewer with rework loops on every PR.",
    enabled: false,
    icon: "MessageSquareCode",
  },
  {
    id: "animus.engineering-backlog",
    title: "Maintenance",
    description: "Burns down your P3 backlog overnight.",
    enabled: false,
    icon: "ListTodo",
  },
  {
    id: "animus.customer-support",
    title: "Customer support",
    description: "Triage tickets, draft responses, escalate when needed.",
    enabled: false,
    icon: "LifeBuoy",
  },
  {
    id: "animus.sales-pipeline",
    title: "Sales pipeline",
    description: "Lead enrichment, qualification, and pipeline updates.",
    enabled: false,
    icon: "TrendingUp",
  },
  {
    id: "animus.recruiting-pipeline",
    title: "Recruiting",
    description: "Candidate triage, scheduling, and outreach.",
    enabled: false,
    icon: "Users",
  },
  {
    id: "animus.marketing-outreach",
    title: "Marketing outreach",
    description: "Outbound campaigns and personalization.",
    enabled: false,
    icon: "Megaphone",
  },
  {
    id: "animus.ecommerce-fulfillment",
    title: "Ecommerce ops",
    description: "Order and fulfillment automation.",
    enabled: false,
    icon: "ShoppingCart",
  },
  {
    id: "animus.organization-meetings",
    title: "Meetings",
    description: "Prep, notes, and follow-ups across your calendar.",
    enabled: false,
    icon: "Calendar",
  },
  {
    id: "animus.requirement",
    title: "Requirements",
    description: "Refinement and acceptance gates for new work.",
    enabled: false,
    icon: "ClipboardCheck",
  },
  {
    id: "animus.core-skills",
    title: "Core skills",
    description: "Foundational skills bundled into other packs.",
    enabled: false,
    hidden: true,
    icon: "Package",
  },
];

/**
 * The 11 recommended packs surfaced as "Recommended" in Settings → Plugins.
 * Matches docs/PLUGIN-ECOSYSTEM.md.
 */
export interface RecommendedPlugin {
  name: string;
  kind: string;
  version: string;
  repo: string;
  installed: boolean;
}

export const RECOMMENDED_PACKS: RecommendedPlugin[] = [
  {
    name: "animus.task",
    kind: "pack",
    version: "0.1.1",
    repo: "launchapp-dev/animus-pack-task",
    installed: false,
  },
  {
    name: "animus.requirement",
    kind: "pack",
    version: "0.1.1",
    repo: "launchapp-dev/animus-pack-requirement",
    installed: false,
  },
  {
    name: "animus.review",
    kind: "pack",
    version: "0.1.1",
    repo: "launchapp-dev/animus-pack-review",
    installed: false,
  },
  {
    name: "animus.core-skills",
    kind: "pack",
    version: "0.1.1",
    repo: "launchapp-dev/animus-pack-core-skills",
    installed: false,
  },
  {
    name: "animus.engineering-backlog",
    kind: "pack",
    version: "0.1.0",
    repo: "launchapp-dev/animus-pack-engineering-backlog",
    installed: false,
  },
  {
    name: "animus.customer-support",
    kind: "pack",
    version: "0.1.0",
    repo: "launchapp-dev/animus-pack-customer-support",
    installed: false,
  },
  {
    name: "animus.sales-pipeline",
    kind: "pack",
    version: "0.1.0",
    repo: "launchapp-dev/animus-pack-sales-pipeline",
    installed: false,
  },
  {
    name: "animus.marketing-outreach",
    kind: "pack",
    version: "0.1.0",
    repo: "launchapp-dev/animus-pack-marketing-outreach",
    installed: false,
  },
  {
    name: "animus.recruiting-pipeline",
    kind: "pack",
    version: "0.1.0",
    repo: "launchapp-dev/animus-pack-recruiting-pipeline",
    installed: false,
  },
  {
    name: "animus.ecommerce-fulfillment",
    kind: "pack",
    version: "0.1.0",
    repo: "launchapp-dev/animus-pack-ecommerce-fulfillment",
    installed: false,
  },
  {
    name: "animus.organization-meetings",
    kind: "pack",
    version: "0.1.0",
    repo: "launchapp-dev/animus-pack-organization-meetings",
    installed: false,
  },
];
