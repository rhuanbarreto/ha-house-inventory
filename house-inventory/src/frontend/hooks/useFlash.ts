/**
 * Flash message state — replaces the old URL-based ?flash= pattern.
 * Provides a context + hook so any component can push a flash notification.
 */

import { createContext, useCallback, useContext, useState } from "react";
import type { FlashKind, FlashMessage } from "../types.ts";

let _nextId = 0;

export interface FlashContextValue {
  flashes: FlashMessage[];
  flash: (kind: FlashKind, text: string) => void;
  dismiss: (id: number) => void;
}

export const FlashContext = createContext<FlashContextValue>({
  flashes: [],
  flash: () => {},
  dismiss: () => {},
});

export function useFlash(): FlashContextValue {
  return useContext(FlashContext);
}

export function useFlashState(): FlashContextValue {
  const [flashes, setFlashes] = useState<FlashMessage[]>([]);

  const flash = useCallback((kind: FlashKind, text: string) => {
    const id = ++_nextId;
    setFlashes((prev) => [...prev, { id, kind, text }]);
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setFlashes((prev) => prev.filter((f) => f.id !== id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setFlashes((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return { flashes, flash, dismiss };
}
