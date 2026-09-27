"use client";

import { useEffect } from "react";

interface Target {
  impressionId: string;
  section: string;
  elementId: string;
}

const FLUSH_DELAY_MS = 1500;
const VISIBLE_RATIO = 0.5;

function send(body: string): void {
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon?.("/api/instrumentation/exposure", blob)) return;
  void fetch("/api/instrumentation/exposure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function ExposureTracker({ targets }: { targets: Target[] }) {
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    for (const target of targets) {
      const seen = new Set<number>();
      let pending: number[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;

      const flush = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (pending.length === 0) return;
        send(JSON.stringify({ impressionId: target.impressionId, section: target.section, positions: pending }));
        pending = [];
      };

      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting || entry.intersectionRatio < VISIBLE_RATIO) continue;
            const position = Number((entry.target as HTMLElement).dataset.recPosition);
            if (!Number.isInteger(position) || seen.has(position)) continue;
            seen.add(position);
            pending.push(position);
            io.unobserve(entry.target);
          }
          if (pending.length > 0 && !timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
        },
        { threshold: VISIBLE_RATIO },
      );

      const attach = (): boolean => {
        const section = document.getElementById(target.elementId);
        if (!section) return false;
        section.querySelectorAll<HTMLElement>("[data-rec-position]").forEach((el) => io.observe(el));
        return true;
      };

      let mo: MutationObserver | null = null;
      if (!attach()) {
        mo = new MutationObserver(() => {
          if (attach()) mo?.disconnect();
        });
        mo.observe(document.body, { childList: true, subtree: true });
      }

      const onHide = () => {
        if (document.visibilityState === "hidden") flush();
      };
      document.addEventListener("visibilitychange", onHide);

      cleanups.push(() => {
        flush();
        io.disconnect();
        mo?.disconnect();
        document.removeEventListener("visibilitychange", onHide);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, [targets]);

  return null;
}
