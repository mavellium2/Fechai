import type { Metadata } from "next";
import { requireBroadcastAccess } from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import { listBroadcastPage } from "@/modules/broadcasts/queries";
import { ConnectMetaCard } from "./ConnectMetaCard";
import { BroadcastList } from "./BroadcastList";
import { DisparosNav } from "./DisparosNav";

export const metadata: Metadata = { title: "Disparos" };

export default async function DisparosPage() {
  const tenantId = await requireBroadcastAccess();
  const [connection, campaigns] = await Promise.all([
    getBroadcastConnection(tenantId),
    listBroadcastPage(tenantId),
  ]);
  return (
    <>
      {connection || campaigns.total > 0 ? (
        <BroadcastList
          initial={campaigns}
          connected={Boolean(connection)}
          banner={connection ? null : <ConnectMetaCard />}
        />
      ) : (
        <>
          <DisparosNav />
          <ConnectMetaCard />
        </>
      )}
    </>
  );
}
