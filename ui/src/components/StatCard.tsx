import type { ReactNode } from "react";

export default function StatCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: ReactNode;
  helper?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-950 p-5 shadow-lg shadow-slate-950/40">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
        {icon}
      </div>
      <div className="mt-4 text-2xl font-semibold text-white">{value}</div>
      {helper && <p className="mt-2 text-sm text-slate-400">{helper}</p>}
    </div>
  );
}
