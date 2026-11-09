import { requireBroadcastAccess } from "@/modules/broadcasts/access";

export default async function DisparosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireBroadcastAccess();
  // Cada tela monta a própria faixa de abas (`DisparosNav`) com as suas ações.
  return <div className="space-y-5">{children}</div>;
}
