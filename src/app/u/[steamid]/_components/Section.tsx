import type { ReactNode } from "react";

export function Section({
  title,
  subtitle,
  id,
  children,
}: {
  title: string;
  subtitle?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-10">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {subtitle ? <p className="mt-1 text-xs leading-5 text-muted">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SectionSkeleton({ title, cards = 4 }: { title: string; cards?: number }) {
  return (
    <Section title={title}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="animate-pulse overflow-hidden rounded-lg border border-edge bg-surface">
            <div className="aspect-460/215 bg-raised" />
            <div className="space-y-2 p-3">
              <div className="h-3.5 w-3/4 rounded bg-raised" />
              <div className="h-3 w-1/2 rounded bg-raised" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-edge bg-surface px-4 py-6 text-center text-sm text-muted">
      {children}
    </p>
  );
}
