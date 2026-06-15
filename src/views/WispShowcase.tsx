import { Wisp, type WispExpression } from "../components/Wisp";

const EXPRESSIONS: { key: WispExpression; label: string; note: string }[] = [
  { key: "awake", label: "AWAKE", note: "daemon idle · ready" },
  { key: "working", label: "WORKING", note: "cycle running · focused" },
  { key: "done", label: "DONE", note: "cycle green · pleased" },
  { key: "resting", label: "RESTING", note: "nothing scheduled" },
  { key: "needs-you", label: "NEEDS YOU", note: "blocked · waiting" },
];

const MOTIONS = ["breathe", "flicker", "working", "ignite", "celebrate", "blink", "thinking", "alert"] as const;

function Section({ id, title, blurb, children }: { id: string; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--wisp-flame)" }}>{id} · {title}</span>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{blurb}</span>
      </div>
      {children}
    </section>
  );
}

const tile: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--line, rgba(255,255,255,0.08))",
  borderRadius: 12,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
  ["--wisp-eye" as string]: "var(--surface-1)",
};

export function WispShowcase() {
  return (
    <div style={{ padding: "24px 28px 80px", color: "var(--text)", maxWidth: 1100 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Wisp</h1>
      <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 28px", maxWidth: 760, lineHeight: 1.6 }}>
        The spirit that does the work. One character — five faces, a motion library with flat fallbacks, and the rules that keep it consistent from a 16px tray glyph to a hero.
      </p>

      <Section id="01" title="THE MARK" blurb="The hero, breathing.">
        <div style={{ ...tile, padding: 40, alignSelf: "flex-start", width: 220 }}>
          <Wisp expression="awake" size={140} title="Wisp" />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "var(--wisp-flame)" }}>FLAME · #3ed3a4 / #1d9e75</span>
        </div>
      </Section>

      <Section id="04" title="EXPRESSION SYSTEM" blurb="The daemon's state is Wisp's face.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 11 }}>
          {EXPRESSIONS.map((e) => (
            <div key={e.key} style={tile}>
              <Wisp expression={e.key} size={84} motion="none" />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: "var(--wisp-flame)" }}>{e.label}</span>
              <span style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "center" }}>{e.note}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="05" title="MOTION LIBRARY" blurb="Live animation · flat fallback under reduced motion.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {MOTIONS.map((m) => (
            <div key={m} style={tile}>
              <Wisp expression={m === "alert" ? "needs-you" : m === "working" ? "working" : m === "celebrate" ? "done" : "awake"} size={66} motion={m} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: "var(--text)" }}>{m.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="07" title="SIZING" blurb="512 → 16px. Eyes thicken as it shrinks.">
        <div style={{ ...tile, flexDirection: "row", alignItems: "flex-end", gap: 28, alignSelf: "flex-start" }}>
          {[96, 48, 32, 22, 16].map((s) => (
            <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <Wisp expression="awake" size={s} motion="none" mono={s <= 16} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "var(--text-faint)" }}>{s}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="08" title="LOCKUPS" blurb="Wisp + wordmark.">
        <div style={{ ...tile, flexDirection: "row", gap: 11, alignSelf: "flex-start", padding: "18px 22px" }}>
          <Wisp expression="awake" size={30} motion="none" />
          <span style={{ fontSize: 20, fontWeight: 700 }}>animus</span>
        </div>
      </Section>
    </div>
  );
}
