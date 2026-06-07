import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Map Tailwind utility classes to the existing CSS-var design tokens
        // so that `bg-bg`, `text-text`, `border-border`, etc. work alongside
        // the existing styles.css.
        bg: "var(--bg)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-raised": "var(--bg-raised)",
        "bg-hover": "var(--bg-hover)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        "text-faint": "var(--text-faint)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-bg": "var(--accent-bg)",
        green: "var(--green)",
        "green-bg": "var(--green-bg)",
        red: "var(--red)",
        "red-bg": "var(--red-bg)",
        yellow: "var(--yellow)",
        "yellow-bg": "var(--yellow-bg)",
        blue: "var(--blue)",
        "blue-bg": "var(--blue-bg)",
        gray: "var(--gray)",
        "gray-bg": "var(--gray-bg)",
        // shadcn semantic aliases mapped to our palette
        background: "var(--bg)",
        foreground: "var(--text)",
        card: "var(--bg-elevated)",
        "card-foreground": "var(--text)",
        popover: "var(--bg-elevated)",
        "popover-foreground": "var(--text)",
        primary: "var(--accent)",
        "primary-foreground": "#0a0d12",
        secondary: "var(--bg-raised)",
        "secondary-foreground": "var(--text)",
        muted: "var(--bg-hover)",
        "muted-foreground": "var(--text-muted)",
        destructive: "var(--red)",
        "destructive-foreground": "#0a0d12",
        input: "var(--border)",
        ring: "var(--accent)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
