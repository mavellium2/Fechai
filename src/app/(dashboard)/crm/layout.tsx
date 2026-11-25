import { requireCrmAccess } from "@/modules/crm/access";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await requireCrmAccess();
  return children;
}
