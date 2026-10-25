import { Check, X } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { tenantChecks, type Check as HealthCheck } from "@/lib/health";
import { getUsageSummary, type UsageSummary } from "@/modules/billing/usage";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getAccountRoles, isAffiliateOnly } from "@/modules/affiliates/roles";
import { ProfileForm } from "./ProfileForm";
import { RolesForm } from "./RolesForm";
import { PasswordForm } from "./PasswordForm";
import { ServiceAreaForm } from "./ServiceAreaForm";
import { getServiceArea } from "@/modules/lead-insights/service-area-store";

/** Traduz o status cru do provedor que vem no `detail` do check de WhatsApp. */
const DETAIL_PT: Record<string, string> = {
  connected: "conectado",
  pending_qr: "aguardando QR",
  disconnected: "desconectado",
};

function CheckRow({ c }: { c: HealthCheck }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            c.ok ? "bg-success text-white" : "bg-white/10 text-white/60"
          }`}
        >
          {c.ok ? <Check size={12} strokeWidth={3} /> : <X size={12} />}
        </span>
        <span className="truncate text-sm text-white/85">
          {c.label}
          {/* o ícone é decorativo: o estado precisa existir em texto */}
          <span className="sr-only">{c.ok ? " — pronto" : " — pendente"}</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {c.detail && (
          <span className="font-mono text-micro uppercase tracking-wide text-white/55">
            {DETAIL_PT[c.detail] ?? c.detail}
          </span>
        )}
        {!c.ok && c.href && (
          <ButtonLink href={c.href} variant="outline" size="sm" aria-label={`Resolver: ${c.label}`}>
            Resolver
          </ButtonLink>
        )}
      </div>
    </li>
  );
}

function UsageCard({ usage }: { usage: UsageSummary }) {
  const pct = usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 100;
  const barTone = usage.atLimit ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-iris";

  return (
    <Card>
      <CardTitle
        hint="Mensagens que a IA respondeu neste mês. O chat de teste não conta."
        action={
          <span
            className={`font-mono text-micro uppercase tracking-[0.15em] ${
              usage.atLimit ? "text-danger" : "text-white/60"
            }`}
          >
            {usage.trialExpired
              ? "teste encerrado"
              : usage.outOfMessages
                ? "limite atingido"
                : `${usage.used.toLocaleString("pt-BR")} de ${usage.limit.toLocaleString("pt-BR")}`}
          </span>
        }
      >
        Uso atual
      </CardTitle>

      {/* Teste em andamento: o prazo pode acabar antes da cota, então ele vem
          antes do número — é a informação que decide o que a pessoa faz agora. */}
      {usage.isTrial && !usage.trialExpired && (
        <p className="mb-4 rounded-surface border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white/85">
          Você está no período de teste: faltam{" "}
          <strong className="font-semibold text-white">
            {usage.trialDaysLeft} dia{usage.trialDaysLeft === 1 ? "" : "s"}
          </strong>
          {usage.trialEndsAt && <> (até {usage.trialEndsAt.toLocaleDateString("pt-BR")})</>}. Quando
          o prazo acabar, a IA para de responder e você escolhe um plano para continuar — seus
          contatos e conversas ficam salvos.
        </p>
      )}

      <div>
        <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/55">
          Mensagens da IA · este mês
        </p>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="font-display text-lg font-semibold text-white">
            {usage.used.toLocaleString("pt-BR")}
            <span className="text-white/55"> de {usage.limit.toLocaleString("pt-BR")}</span>
          </p>
          <span
            className={`font-mono text-micro uppercase tracking-[0.15em] ${
              usage.outOfMessages ? "text-danger" : "text-white/45"
            }`}
          >
            {pct}%
          </span>
        </div>
        <div aria-hidden className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
        </div>

        <p className="mt-2 text-sm leading-relaxed text-white/85">
          {usage.trialExpired ? (
            <>
              Seu período de teste terminou e a IA parou de responder. As novas mensagens continuam
              chegando em Conversas, marcadas como “precisa de você”, e você pode responder à mão —
              escolha um plano para o agente voltar a atender sozinho.
            </>
          ) : usage.outOfMessages ? (
            <>
              Você chegou às {usage.limit.toLocaleString("pt-BR")} mensagens do plano{" "}
              {usage.plan.name} neste mês. A IA parou de responder automaticamente — as novas
              mensagens ficam registradas em Conversas, marcadas como “precisa de você”.
            </>
          ) : (
            <>
              Você usou {pct}% das mensagens do plano {usage.plan.name} neste mês.
              {usage.override && " (limite definido pelo suporte)"}
            </>
          )}
        </p>

        {usage.atLimit ? (
          usage.nextPlan ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-surface border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-white/75">
                O plano <span className="font-medium text-white">{usage.nextPlan.name}</span>{" "}
                oferece {usage.nextPlan.messagesPerMonth.toLocaleString("pt-BR")} mensagens/mês.
              </p>
              <ButtonLink href="/planos" size="sm">
                Ver planos
              </ButtonLink>
            </div>
          ) : (
            <p className="mt-3 text-sm text-white/55">
              Você está no plano máximo. Fale com o suporte para aumentar o limite.
            </p>
          )
        ) : null}
      </div>
    </Card>
  );
}

export default async function ConfiguracoesPage() {
  const { session, tenantId } = await requireTenant();

  // Direto do banco, não da sessão: o nome no JWT só atualiza no próximo
  // login, então relendo aqui o formulário sempre mostra o valor salvo.
  const roles = await getAccountRoles(session.user.id);
  const affiliateOnly = isAffiliateOnly(roles);

  // Cota e checklist de configuração medem o agente: para quem só afilia são
  // perguntas sem objeto, e nem chegam a ser consultadas.
  const [user, checks, usage, serviceArea, tenant] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, email: true },
    }),
    affiliateOnly ? null : tenantChecks(tenantId),
    affiliateOnly ? null : getUsageSummary(tenantId),
    affiliateOnly ? null : getServiceArea(tenantId),
    affiliateOnly ? null : prisma.tenant.findUnique({ where: { id: tenantId }, select: { city: true } }),
  ]);
  const pending = checks ? checks.filter((c) => !c.ok).length : 0;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="configurações"
        title="Configurações"
        description="Sua conta e status da configuração."
        className="mb-2"
      />

      {usage && <UsageCard usage={usage} />}

      {/*
        Mesmo grid de /inicio: coluna principal (2/3) para o que se edita,
        coluna lateral (1/3) para status e ações secundárias. Em telas
        estreitas cai para 1 coluna só — a ordem no DOM já é a leitura certa.
      */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardTitle>Perfil</CardTitle>
            <ProfileForm name={user.name ?? ""} email={user.email} />
          </Card>

          <Card>
            <CardTitle hint="Recomendado a cada alguns meses.">Senha</CardTitle>
            <PasswordForm />
          </Card>

          {!affiliateOnly && (
            <Card>
              <CardTitle hintInline hint="Define o que é lead de fora do raio nos relatórios de qualidade dos leads.">
                Área de atendimento
              </CardTitle>
              <ServiceAreaForm baseCity={serviceArea?.baseCity ?? null} cities={serviceArea?.cities ?? []} suggestedCity={tenant?.city ?? null} />
            </Card>
          )}

          <Card>
            <CardTitle hintInline hint="Define o que aparece no menu. Você pode marcar as duas.">
              Como você usa o fechai
            </CardTitle>
            <RolesForm usesProduct={roles.usesProduct} isAffiliate={roles.isAffiliate} />
          </Card>
        </div>

        <div className="space-y-6">
          {checks && (
          <Card>
            <CardTitle
              hint="Complete todos para o agente funcionar 100%."
              action={
                <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
                  {pending === 0 ? "tudo pronto" : `${pending} pendente${pending > 1 ? "s" : ""}`}
                </span>
              }
            >
              Sua configuração
            </CardTitle>
            <ul className="divide-y divide-white/5">
              {checks.map((c) => (
                <CheckRow key={c.label} c={c} />
              ))}
            </ul>
          </Card>
          )}
        </div>
      </div>
    </div>
  );
}
