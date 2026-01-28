export default function StatusBadge({ label, tone }: { label: string; tone?: "good" | "warn" | "error" }) {
  const toneStyles =
    tone === "good"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
      : tone === "warn"
        ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
        : tone === "error"
          ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
          : "bg-slate-800/60 text-slate-300 border-slate-700/60";
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${toneStyles}`}>
      {label}
    </span>
  );
}
