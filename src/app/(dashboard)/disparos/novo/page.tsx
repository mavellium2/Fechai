import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireBroadcastActor } from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import { normalizeBroadcastPhone } from "@/modules/broadcasts/phone";
import { looksBrazilianWithoutCountry } from "@/modules/broadcasts/contacts";
import { DisparosNav } from "../DisparosNav";
import { Alert } from "@/components/ui/alert";
import { ConnectMetaCard } from "../ConnectMetaCard";
import { NewBroadcastWizard } from "../NewBroadcastWizard";
import { formatPhone } from "../labels";
import { getBroadcastReview } from "../actions";

export const metadata: Metadata = { title: "Novo disparo" };

/** Número de quem está logado, para o teste já vir preenchido. */
function testPhoneFrom(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const full = looksBrazilianWithoutCountry(digits) ? `55${digits}` : digits;
  const normalized = normalizeBroadcastPhone(full);
  return normalized ? formatPhone(normalized) : "";
}

export default async function NovoDisparoPage({
  searchParams,
}: {
  searchParams: Promise<{ rascunho?: string; modelo?: string }>;
}) {
  const { tenantId, userId } = await requireBroadcastActor();
  const { rascunho, modelo } = await searchParams;
  const [connection, user, draft] = await Promise.all([
    getBroadcastConnection(tenantId),
    prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
    rascunho ? getBroadcastReview(rascunho) : Promise.resolve(null),
  ]);
  return (
    <div className="space-y-6">
      {connection ? (
        <NewBroadcastWizard
          displayPhone={connection.displayPhone ?? null}
          defaultTestPhone={testPhoneFrom(user?.phone)}
          draft={draft}
          initialTemplateId={draft ? undefined : modelo}
          notice={
            rascunho && !draft ? (
              <Alert tone="warn">
                Este rascunho não está mais disponível (já foi enviado ou descartado). Comece um novo abaixo.
              </Alert>
            ) : null
          }
        />
      ) : (
        <>
          <DisparosNav />
          <ConnectMetaCard />
        </>
      )}
    </div>
  );
}
