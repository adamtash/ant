import type { PropsWithChildren, ReactNode } from "react";

export default function Panel({
  title,
  description,
  actions,
  children,
}: PropsWithChildren<{
  title: string;
  description?: string;
  actions?: ReactNode;
}>) {
  return (
    <section className="rounded-2xl border border-slate-800/60 bg-slate-950 p-6 shadow-xl shadow-slate-950/40">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}
