import { Stat } from "@/components/ui/stat";

export function ReportKpis({ items }: {
  items: { label: string; value: string; comparison: string; about?: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => <Stat key={item.label} label={item.label} value={item.value}
        hint={item.comparison} about={item.about} compact />)}
    </div>
  );
}
