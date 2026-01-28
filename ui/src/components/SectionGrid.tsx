import type { PropsWithChildren } from "react";

export default function SectionGrid({ children }: PropsWithChildren) {
  return <div className="grid gap-6 lg:grid-cols-3">{children}</div>;
}
