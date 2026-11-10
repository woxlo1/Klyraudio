import { useEffect, useRef } from "react";

/** Run an async task immediately and on an interval while the tab is visible. */
export function usePolling(
  task: () => Promise<void> | void,
  intervalMs: number,
  enabled = true,
): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer = 0;

    const run = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "hidden") {
        try {
          await taskRef.current();
        } catch {
          // The caller decides how to surface polling failures.
        }
      }
      if (!cancelled) timer = window.setTimeout(run, intervalMs);
    };

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const previous = document.title;
    if (title) document.title = `${title} · Klyraudio`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export function useKeyDown(handler: (event: KeyboardEvent) => void, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => handlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);
}
