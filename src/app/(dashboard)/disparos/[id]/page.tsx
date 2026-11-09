import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DisparosNav } from "../DisparosNav";
import { CampaignDetail } from "../CampaignDetail";
import { getBroadcastCampaign } from "../actions";

export const metadata: Metadata = { title: "Disparo" };

export default async function DisparoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getBroadcastCampaign(id);
  if (!detail) notFound();
  if (detail.summary.status === "draft") redirect(`/disparos/novo?rascunho=${id}`);
  return (
    <div className="space-y-6">
      <DisparosNav />
      <CampaignDetail initial={detail} />
    </div>
  );
}
