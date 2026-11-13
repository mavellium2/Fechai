import type { ReactNode } from "react";
import { Card, CardTitle } from "@/components/ui/card";

export function ReportInsights({ title, children }: { title: string; children: ReactNode }) {
  return <Card><CardTitle>{title}</CardTitle>{children}</Card>;
}
