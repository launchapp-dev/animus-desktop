import { siClaude, siGooglegemini, siOpencode } from "simple-icons";

interface Props {
  tool: string;
  size?: number;
  className?: string;
}

function SimpleIconMark({
  icon,
  size,
  className,
  colorOverride,
}: {
  icon: { path: string; hex: string };
  size: number;
  className?: string;
  colorOverride?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      fill={colorOverride ?? `#${icon.hex}`}
    >
      <path d={icon.path} />
    </svg>
  );
}

/** Real brand marks. Claude / Gemini / OpenCode come from simple-icons;
 *  OpenAI/Codex use a clean recreation since OpenAI pulled their mark from
 *  the simple-icons set. */
export function ProviderLogo({ tool, size = 16, className }: Props) {
  const t = tool.toLowerCase();

  if (t === "claude") {
    return <SimpleIconMark icon={siClaude} size={size} className={className} />;
  }
  if (t === "gemini") {
    return (
      <SimpleIconMark
        icon={siGooglegemini}
        size={size}
        className={className}
        colorOverride="#8E75B2"
      />
    );
  }
  if (t === "opencode") {
    // brand hex is near-black; use bone so it reads on the dark UI
    return (
      <SimpleIconMark
        icon={siOpencode}
        size={size}
        className={className}
        colorOverride="var(--text)"
      />
    );
  }
  if (t === "codex" || t === "oai" || t === "openai") {
    // OpenAI hexafoil knot (recreation)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        aria-hidden
        fill="none"
      >
        <path
          d="M12 3.4a3.8 3.8 0 013.3 1.9 3.8 3.8 0 011.74 6.03 3.8 3.8 0 01-1.74 6.03 3.8 3.8 0 01-6.6 0 3.8 3.8 0 01-1.74-6.03A3.8 3.8 0 018.7 5.3 3.8 3.8 0 0112 3.4z"
          stroke="#10a37f"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="12" r="2" fill="#10a37f" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <circle cx="12" cy="12" r="8" stroke="var(--text-muted)" strokeWidth="1.6" />
    </svg>
  );
}

export default ProviderLogo;
