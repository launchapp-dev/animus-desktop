import { useEffect } from "react";
import { setWispExpression } from "../api/_invoke";
import { useWispState } from "./useWispState";

/** Pushes the canonical Wisp expression to the macOS tray whenever it changes. */
export function useWispTray(): void {
  const expression = useWispState();
  useEffect(() => {
    void setWispExpression(expression);
  }, [expression]);
}
