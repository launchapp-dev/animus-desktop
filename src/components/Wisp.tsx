export type WispExpression =
  | "awake"
  | "working"
  | "done"
  | "resting"
  | "needs-you";

export type WispMotion =
  | "auto"
  | "breathe"
  | "blink"
  | "flicker"
  | "working"
  | "ignite"
  | "celebrate"
  | "thinking"
  | "alert"
  | "none";

interface WispProps {
  expression?: WispExpression;
  size?: number;
  motion?: WispMotion;
  /** Force the mono-knockout flame (tray / favicons / tiny sizes). */
  mono?: boolean;
  /** Accessible label. When omitted the mark is aria-hidden. */
  title?: string;
  className?: string;
}

// Locked geometry. Standard form (>=24px) and a fattened small form whose eyes
// stay open at tiny sizes (the spec's sizing ladder).
const BODY_STD =
  "M40 11 C51 17 53 33 45 44 C36 53 21 51 17 40 C13 29 24 27 27 19 C30 11 34 8 40 11 Z";
const BODY_SM =
  "M39 6 C52 13 55 33 46 46 C36 56 18 53 14 40 C10 27 23 24 27 15 C30 7 34 3 39 6 Z";

// expression -> the motion that reads as that state
const MOTION_FOR: Record<WispExpression, Exclude<WispMotion, "auto">> = {
  awake: "breathe",
  working: "working",
  done: "celebrate",
  resting: "breathe",
  "needs-you": "alert",
};

const EYE = "var(--wisp-eye)";
const FLAME = "var(--wisp-flame)";
const AMBER = "var(--wisp-amber)";
const CORE = "var(--wisp-core)";

/** Eye / accent overlay for the standard geometry, per expression. */
function StdEyes({ expression }: { expression: WispExpression }) {
  switch (expression) {
    case "working":
      return (
        <>
          <path
            d="M12 24 h6 M10 33 h6"
            stroke={FLAME}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.5}
          />
          <ellipse className="wisp__eye" cx={32.5} cy={30} rx={2.9} ry={1.7} fill={EYE} />
          <ellipse className="wisp__eye" cx={41.5} cy={30} rx={2.9} ry={1.7} fill={EYE} />
        </>
      );
    case "done":
      return (
        <path
          className="wisp__eye"
          d="M28.5 31 q3 -4.5 6 0 M37.5 31 q3 -4.5 6 0"
          stroke={EYE}
          strokeWidth={2.6}
          strokeLinecap="round"
          fill="none"
        />
      );
    case "resting":
      return (
        <>
          <path
            className="wisp__eye"
            d="M28.5 30 q3 2.5 6 0 M37.5 30 q3 2.5 6 0"
            stroke={EYE}
            strokeWidth={2.6}
            strokeLinecap="round"
            fill="none"
          />
          <text x={49} y={19} fontFamily="'JetBrains Mono', monospace" fontSize={11} fontWeight={700} fill={FLAME} opacity={0.8}>z</text>
          <text x={55} y={11} fontFamily="'JetBrains Mono', monospace" fontSize={8} fontWeight={700} fill={FLAME} opacity={0.5}>z</text>
        </>
      );
    case "needs-you":
      return (
        <>
          <path
            className="wisp__eye"
            d="M28.5 30 h6 M37.5 30 h6"
            stroke={EYE}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <g className="wisp__alert-mark">
            <path d="M53 12 v9" stroke={AMBER} strokeWidth={3.5} strokeLinecap="round" />
            <circle cx={53} cy={27} r={2} fill={AMBER} />
          </g>
        </>
      );
    case "awake":
    default:
      return (
        <>
          <circle className="wisp__eye" cx={31.5} cy={30} r={2.7} fill={EYE} />
          <circle className="wisp__eye" cx={40.5} cy={30} r={2.7} fill={EYE} />
        </>
      );
  }
}

export function Wisp({
  expression = "awake",
  size = 24,
  motion = "auto",
  mono = false,
  title,
  className,
}: WispProps) {
  const small = mono || size < 24;
  const flameFill = mono ? "var(--wisp-mono)" : FLAME;
  const resolved: WispMotion = motion === "auto" ? MOTION_FOR[expression] : motion;

  // Root-level motions transform the whole mark; "working" leans an inner group
  // so the streaming motion-lines stay put; "thinking" adds an orbiting spark.
  const rootMotion =
    resolved === "none" || resolved === "working" || resolved === "thinking"
      ? ""
      : `wisp--${resolved}`;
  const leaning = resolved === "working";

  const body = (
    <>
      <path className="wisp__body" d={small ? BODY_SM : BODY_STD} fill={flameFill} />
      {small ? (
        <>
          <circle className="wisp__eye" cx={29} cy={33} r={4.2} fill={EYE} />
          <circle className="wisp__eye" cx={40} cy={33} r={4.2} fill={EYE} />
        </>
      ) : (
        <StdEyes expression={expression} />
      )}
    </>
  );

  return (
    <svg
      className={`wisp-svg ${rootMotion} ${className ?? ""}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {leaning ? <g className="wisp__lean wisp--working">{body}</g> : body}
      {resolved === "thinking" && (
        <g className="wisp__orbit">
          <circle cx={32} cy={6} r={2.3} fill={CORE} />
        </g>
      )}
    </svg>
  );
}
