import { useEffect, useRef, useState } from "react";

const CONFIRM_MS = 3000;

/** Two taps to confirm: first asks, second (within 3 s) runs `onConfirm`. */
export function useConfirm(onConfirm: () => void) {
  const [asking, setAsking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function click() {
    if (timer.current) clearTimeout(timer.current);
    if (!asking) {
      setAsking(true);
      timer.current = setTimeout(() => setAsking(false), CONFIRM_MS);
      return;
    }
    setAsking(false);
    onConfirm();
  }

  return { asking, click };
}
