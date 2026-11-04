import type { ReactNode } from "react";

/** Page title, one-line summary and page actions, as on every dashboard mockup. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-heading sm:text-display">{title}</h1>
        {description && <p className="mt-1 text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/** The padded, width-limited content area of a dashboard page. */
export function PageBody({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <main
      aria-label={label}
      className="flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-12 lg:py-12"
    >
      {children}
    </main>
  );
}
