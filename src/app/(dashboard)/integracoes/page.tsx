// `AtSign` e não um ícone de marca: o lucide removeu os logos de terceiros, e
// inventar um SVG do Instagram aqui criaria um ícone fora do conjunto.
import Link from "next/link";
import { BitrixCard } from "./BitrixCard";
import { getBitrixStatus } from "@/modules/bitrix/integration";
import { AtSign, Globe, MessageCircle, ShieldCheck } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { metaWebhookUrl, readMetaWebhookSecrets } from "@/modules/whatsapp/meta-config";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusDot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { PageHeader } from "@/components/ui/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { dateLabel, relativeTime } from "@/lib/format";
import { ensureTenantWidgetDeployed } from "@/lib/widget/deploy";
import { isGoogleCalendarConfigured } from "@/modules/scheduling/google";
import { getCalendarFeatures } from "@/modules/scheduling/features";
import { getClinicorpStatus, listClinicorpBusinesses } from "@/modules/scheduling/clinicorp";
import { isEncryptionConfigured } from "@/lib/crypto";
import { CalendarFeatureToggles } from "./CalendarFeatureToggles";
import { GoogleCalendarCard, type GoogleState } from "./GoogleCalendarCard";
import { ClinicorpCard, type ClinicorpState } from "./ClinicorpCard";
import { listBlockedNumbers } from "@/modules/whatsapp/blocklist";
import { WhatsappConnect } from "./WhatsappConnect";
import { MetaWhatsappConnect } from "./MetaWhatsappConnect";
import { embeddedSignupPublicConfig } from "@/modules/whatsapp/embedded-signup-config";
import { AttendanceControls } from "./WhatsappControls";
import { WhatsappBlocklist } from "./WhatsappBlocklist";
import { SnippetBox } from "./SnippetBox";

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warn" | "neutral" }> = {
  disconnected: { label: "Não conectado", tone: "neutral" },
  pending_qr: { label: "Aguardando leitura", tone: "warn" },
  connected: { label: "Conectado", tone: "success" },
};

/** As famílias de integração da tela. `canais` é o padrão. */
const TABS = [
  { key: "canais", label: "Canais" },
  { key: "calendarios", label: "Calendários" },
  { key: "crm", label: "CRM" },
] as const;

export default async function IntegracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { aba } = await searchParams;
  // Parâmetro de URL é editável: qualquer coisa fora da lista cai em "canais".
  const tab = TABS.some((t) => t.key === aba) ? (aba as (typeof TABS)[number]["key"]) : "canais";

  const since = new Date(new Date().getTime() - 7 * 86_400_000);
  const [instances, inboundLast7, tenant, agent, blocked] = await Promise.all([
    prisma.whatsappInstance.findMany({ where: { tenantId } }),
    prisma.message.count({
      where: { role: "user", createdAt: { gte: since }, conversation: { tenantId } },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        widgetColor: true,
        widgetGreeting: true,
        widgetIconType: true,
        widgetIconEmoji: true,
        widgetIconUrl: true,
        widgetShape: true,
        widgetBorderColor: true,
        widgetEnabled: true,
        whatsappIgnoreGroups: true,
        metaWhatsappEnabled: true,
        evolutionWhatsappEnabled: true,
      },
    }),
    prisma.agent.findFirst({
      where: { tenantId, archived: false },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { name: true, enabled: true },
    }),
    listBlockedNumbers(tenantId),
  ]);

  // Publica o widget.js do tenant na CDN na primeira visita — sem comando
  // manual. No-op se já foi publicado (ver ensureTenantWidgetDeployed).
  await ensureTenantWidgetDeployed(tenantId);

  // Só a aba de calendários precisa disso: nada de pagar por essas queries em
  // quem abriu a tela para conectar o WhatsApp.
  const calendars =
    tab === "calendarios"
      ? await Promise.all([
          getCalendarFeatures(tenantId),
          prisma.calendarIntegration.findUnique({ where: { tenantId } }),
          getClinicorpStatus(tenantId),
        ])
      : null;

  const bitrix = tab === "crm" ? await getBitrixStatus(tenantId) : null;

  const [features, googleRow, clinicorpRow] = calendars ?? [null, null, null];

  const googleState: GoogleState | null = !features?.googleEnabled
    ? null
    : !isGoogleCalendarConfigured()
      ? { configured: false }
      : googleRow
        ? {
            configured: true,
            connected: true,
            accountEmail: googleRow.accountEmail,
            syncEnabled: googleRow.syncEnabled,
          }
        : { configured: true, connected: false };

  // As clínicas do assinante são uma chamada de rede ao Clinicorp — só quando
  // há conexão de pé para consultar.
  const clinicorpState: ClinicorpState | null = !features?.clinicorpEnabled
    ? null
    : clinicorpRow
      ? {
          connected: true,
          subscriberId: clinicorpRow.subscriberId,
          businessId: clinicorpRow.businessId,
          dentistId: clinicorpRow.dentistId,
          categoryDescription: clinicorpRow.categoryDescription,
          syncEnabled: clinicorpRow.syncEnabled,
          checkAvailability: clinicorpRow.checkAvailability,
          lastError: clinicorpRow.lastError,
          // Calculado aqui, não no cliente: "há 3 horas" com o relógio do
          // navegador divergiria do HTML do servidor na hidratação.
          lastErrorWhen: clinicorpRow.lastErrorAt ? relativeTime(clinicorpRow.lastErrorAt) : null,
          businesses: await listClinicorpBusinesses(tenantId),
        }
      : { connected: false };

  // Uma linha por conexão: o QR code (Evolution) e a API oficial (Meta) podem
  // estar de pé ao mesmo tempo, cada uma com o seu número.
  const metaEnabled = tenant?.metaWhatsappEnabled ?? false;
  const evolutionRow = instances.find((i) => i.provider !== "meta") ?? null;
  // Falha fechada para linhas antigas ou alteradas à mão: sem liberação do
  // admin, nem o cartão da Meta nem um status conectado residual ficam expostos.
  const metaRow = metaEnabled ? (instances.find((i) => i.provider === "meta") ?? null) : null;

  // QR desligado pelo admin: a linha segue `connected` no banco (a sessão do
  // aparelho não é derrubada), mas para a conta o número está fora. Falha
  // fechado — sem status conectado, sem QR e sem "Conectar". O cartão só
  // aparece, com o aviso, para quem já usou o QR; quem nunca conectou não vê nada.
  const evolutionEnabled = tenant?.evolutionWhatsappEnabled ?? true;
  const evolutionDisabledNotice = !evolutionEnabled && Boolean(evolutionRow?.externalId);
  const evolutionConfigured = getWhatsAppProvider("evolution").isConfigured();
  const evolutionStatus = evolutionEnabled ? (evolutionRow?.status ?? "disconnected") : "disconnected";
  const metaStatus = metaRow?.status ?? "disconnected";
  const evolutionConnected = evolutionStatus === "connected";
  const metaConnected = metaStatus === "connected";
  const connected = evolutionConnected || metaConnected;
  const evolutionLabel = STATUS_LABEL[evolutionStatus] ?? { label: evolutionStatus, tone: "neutral" as const };
  const metaLabel = STATUS_LABEL[metaStatus] ?? { label: metaStatus, tone: "neutral" as const };
  const metaSecrets = metaRow ? readMetaWebhookSecrets(metaRow) : null;
  // Sem a Meta liberada a conta tem uma conexão só e o cartão de sempre; com
  // ela, cada conexão ganha o seu cartão. Gerar o QR sozinho ao abrir a tela só
  // vale para quem usa (ou pode usar) o QR: conta que só tem a Meta não cria uma
  // instância na Evolution por visitar a página.
  const autoStartQr = evolutionEnabled && (!metaEnabled || Boolean(evolutionRow?.externalId));
  const agentName = agent?.name ?? "Agente";
  const agentEnabled = agent?.enabled ?? false;
  const ignoreGroups = tenant?.whatsappIgnoreGroups ?? true;

  // Sem WhatsappConnect de propósito: nada de QR nem de botão de conectar.
  const evolutionDisabledCard = (
    <Card className="md:p-8">
      <CardTitle
        as="h3"
        hintLabel="WhatsApp por QR code"
        hint="Esta conexão foi desativada pelo administrador."
        action={<StatusDot tone="neutral">Desativado</StatusDot>}
      >
        <span className="inline-flex items-center gap-2">
          <MessageCircle size={18} aria-hidden className="text-white/40" />
          Número por QR code
        </span>
      </CardTitle>
      <p className="mt-3 max-w-prose text-sm text-white/60">
        Desativado pelo administrador. O agente não recebe nem envia mensagens por este número
        enquanto isso. Para reativar, fale com o suporte.
      </p>
    </Card>
  );

  return (
    <div className="w-full space-y-8">
      <PageHeader
        eyebrow="integracoes"
        title="Integrações"
        description={
          connected
            ? "Seu agente já responde no WhatsApp. Aqui você acompanha a conexão e liga os outros canais."
            : "Ligue os canais onde seu agente atende — o WhatsApp e o botão no seu site."
        }
      />

      <FilterTabs
        options={TABS.map((t) => ({ key: t.key, label: t.label }))}
        active={tab}
        href={(key) => (key === "canais" ? "/integracoes" : `/integracoes?aba=${key}`)}
        label="Tipo de integração"
      />

      {tab === "calendarios" && features && (
        <section className="space-y-3">
          {/* A explicação virou bolinha (os cards abaixo já mostram o toggle e
              o que fazer), mas o link para a Agenda continua clicável ao lado:
              um balão que fecha ao perder o foco não é lugar para navegação. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display flex items-center gap-1.5 text-lg font-semibold text-white">
              Calendários
              <InfoHint label="calendários">
                Habilite os calendários que sua conta usa e conecte cada um aqui. O que estiver
                ligado aparece como status na Agenda.
              </InfoHint>
            </h2>
            <Link
              href="/agenda"
              className="rounded-control font-mono text-micro uppercase tracking-[0.15em] text-white/60 underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              Ver na Agenda
            </Link>
          </div>

          <CalendarFeatureToggles
            items={[
              {
                key: "google",
                name: "Google Agenda",
                description: "Espelha os horários marcados aqui na agenda do Google.",
                enabled: features.googleEnabled,
                connected: Boolean(googleRow),
                unavailable: isGoogleCalendarConfigured()
                  ? undefined
                  : "Faltam as credenciais do Google no servidor desta instalação.",
              },
              {
                key: "clinicorp",
                name: "Clinicorp",
                description:
                  "Envia os horários para a agenda da clínica e consulta o que já está ocupado lá.",
                enabled: features.clinicorpEnabled,
                connected: Boolean(clinicorpRow),
                unavailable: isEncryptionConfigured()
                  ? undefined
                  : "Falta a chave de criptografia no servidor desta instalação.",
              },
            ]}
            // Cada formulário renderiza dentro do card do seu toggle: ligar e
            // configurar viraram um passo só, sem card solto embaixo.
            panels={{
              google: googleState ? <GoogleCalendarCard state={googleState} /> : null,
              clinicorp: clinicorpState ? <ClinicorpCard state={clinicorpState} /> : null,
            }}
          />
        </section>
      )}

      {tab === "crm" && <BitrixCard state={bitrix} available={isEncryptionConfigured()} />}

      {tab === "canais" && (
        <>
      {evolutionEnabled && !evolutionConfigured && (
        <Alert tone="warn" title="Conexão indisponível neste ambiente">
          A Evolution API não está configurada neste ambiente.{" "}
          <ButtonLink href="/conversas" variant="ghost" size="sm" className="ml-1 underline">
            Ir para Conversas
          </ButtonLink>
        </Alert>
      )}

      {metaEnabled ? (
        /*
          Com a API oficial liberada a conta pode ter os dois números de pé. Cada
          conexão é um cartão com o próprio estado e o próprio "Desconectar" (uma
          não derruba a outra); o que é da conta — pausar o agente, grupos,
          bloqueios — fica num cartão só, porque não é de um número.
        */
        <section aria-labelledby="whatsapp-numeros" className="space-y-4">
          <div className="space-y-1">
            <h2 id="whatsapp-numeros" className="font-display text-lg font-semibold text-white">
              Números de WhatsApp
            </h2>
            <p className="max-w-prose text-sm text-white/60">
              {evolutionEnabled
                ? "Os dois números podem ficar conectados ao mesmo tempo. O agente responde pelo número em que o contato escreveu, e os Disparos saem sempre pelo oficial."
                : "O agente responde pelo número em que o contato escreveu, e os Disparos saem sempre pelo oficial."}
            </p>
          </div>

          {evolutionEnabled ? (
            <Card className="md:p-8">
              <CardTitle
                as="h3"
                hintLabel="WhatsApp por QR code"
                hint={
                  evolutionConnected
                    ? "Este é o número que seus clientes usam para falar com o agente."
                    : "Conecte lendo o código no celular — leva menos de um minuto."
                }
                action={<StatusDot tone={evolutionLabel.tone}>{evolutionLabel.label}</StatusDot>}
              >
                <span className="inline-flex items-center gap-2">
                  <MessageCircle size={18} aria-hidden className="text-success" />
                  Número por QR code
                </span>
              </CardTitle>

              {/* key={status}: quando desconecta, o componente remonta no estado
                  novo (o status é estado local dele e não se atualizaria sozinho). */}
              <WhatsappConnect
                key={evolutionStatus}
                layout="channel"
                initialStatus={evolutionStatus}
                configured={evolutionConfigured}
                autoStart={autoStartQr}
                connectedSince={
                  evolutionConnected && evolutionRow?.updatedAt
                    ? dateLabel(evolutionRow.updatedAt)
                    : undefined
                }
              />
            </Card>
          ) : (
            evolutionDisabledNotice && evolutionDisabledCard
          )}

          <Card className="md:p-8">
            <CardTitle
              as="h3"
              hintLabel="API oficial da Meta"
              hint={
                metaConnected
                  ? "Número oficial: recebe e responde conversas e envia os Disparos."
                  : "Conecte com as credenciais da WhatsApp Business Platform."
              }
              action={<StatusDot tone={metaLabel.tone}>{metaLabel.label}</StatusDot>}
            >
              <span className="inline-flex items-center gap-2">
                <ShieldCheck size={18} aria-hidden className="text-iris" />
                API oficial da Meta
              </span>
            </CardTitle>

            <MetaWhatsappConnect
              embeddedSignup={embeddedSignupPublicConfig()}
              usesEmbeddedSignup={Boolean(metaRow?.metaCoexistenceSync)}
              key={metaStatus}
              connected={metaConnected}
              agentReplies={metaRow?.agentReplies !== false}
              encryptionConfigured={isEncryptionConfigured()}
              hasCredentials={Boolean(
                metaRow?.metaPhoneNumberId &&
                  metaRow.metaAccessTokenEncrypted &&
                  metaRow.metaAppSecretEncrypted &&
                  metaRow.metaVerifyTokenEncrypted,
              )}
              displayPhone={metaRow?.metaDisplayPhone ?? null}
              phoneNumberId={metaRow?.metaPhoneNumberId ?? null}
              businessAccountId={metaRow?.metaBusinessAccountId ?? null}
              webhookUrl={metaWebhookUrl(tenantId)}
              verifyToken={metaSecrets?.verifyToken ?? null}
            />
          </Card>

          <Card className="space-y-6 md:p-8">
            {connected && (
              <p className="text-sm text-white/70">
                <span className="font-mono tabular-nums text-white">{inboundLast7}</span>{" "}
                {inboundLast7 === 1 ? "mensagem recebida" : "mensagens recebidas"} de clientes nos
                últimos 7 dias, somando os números.
              </p>
            )}
            <AttendanceControls
              agentName={agentName}
              agentEnabled={agentEnabled}
              ignoreGroups={ignoreGroups}
              allNumbers
              as="h3"
            />
            <WhatsappBlocklist blocked={blocked} as="h3" />
          </Card>
        </section>
      ) : !evolutionEnabled ? (
        // Sem a Meta e com o QR desligado a conta não tem número nenhum: nada de
        // controles do atendimento, só o aviso (e nenhum aviso para quem nunca
        // conectou o QR).
        evolutionDisabledNotice && evolutionDisabledCard
      ) : (
        /*
          A tela tem uma missão só e ela muda com o estado: desconectada, o código
          é o assunto inteiro; conectada, nada disso é útil e o card vira painel de
          saúde do canal (quem decide isso é o WhatsappConnect).
        */
        <Card className="md:p-8">
          <CardTitle
            hintLabel="WhatsApp"
            hint={
              evolutionConnected
                ? "Este é o número que seus clientes usam para falar com o agente."
                : "Leva menos de um minuto — o código é gerado assim que a página abre."
            }
            action={<StatusDot tone={evolutionLabel.tone}>{evolutionLabel.label}</StatusDot>}
          >
            <span className="inline-flex items-center gap-2">
              <MessageCircle size={18} aria-hidden className="text-success" />
              WhatsApp
            </span>
          </CardTitle>

          {/* key={status}: quando desconecta, o WhatsappConnect remonta no estado
              novo (o status é estado local dele e não se atualizaria sozinho). */}
          <WhatsappConnect
            key={evolutionStatus}
            initialStatus={evolutionStatus}
            configured={evolutionConfigured}
            connectedSince={
              evolutionConnected && evolutionRow?.updatedAt
                ? dateLabel(evolutionRow.updatedAt)
                : undefined
            }
            inboundLast7={evolutionConnected ? inboundLast7 : undefined}
            agentName={agentName}
            agentEnabled={agentEnabled}
            ignoreGroups={ignoreGroups}
            blocked={blocked}
          />
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-white">Outros canais</h2>
        <p className="max-w-prose text-sm text-white/60">
          Seu agente pode atender em mais de um lugar. O que estiver ligado usa a mesma persona e a
          mesma base de conhecimento.
        </p>

        <Card className="p-0">
          {/* `<details>` nativo: abre sem JS, é navegável por teclado e não
              precisa de estado nem de biblioteca de acordeão. Fechado por
              padrão — quem quer instalar abre e vê o código. */}
          <details className="group">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 rounded-surface p-4 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
              <Globe size={18} aria-hidden className="text-iris" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">Botão no seu site</span>
                <span className="block text-xs text-white/55">
                  Um código pronto para colar — quem visita o site fala com o agente sem sair da
                  página.
                </span>
              </span>
              <span className="font-mono text-micro uppercase tracking-wide text-white/50 group-open:hidden">
                abrir
              </span>
              <span className="hidden font-mono text-micro uppercase tracking-wide text-white/50 group-open:inline">
                fechar
              </span>
            </summary>
            <div className="border-t border-white/10 p-4">
              <SnippetBox
                tenantId={tenantId}
                widgetEnabled={tenant?.widgetEnabled ?? false}
                widgetColor={tenant?.widgetColor ?? "#6d5ef8"}
                widgetGreeting={tenant?.widgetGreeting ?? "Olá! Como posso ajudar?"}
                widgetIconType={tenant?.widgetIconType ?? "emoji"}
                widgetIconEmoji={tenant?.widgetIconEmoji ?? "💬"}
                widgetIconUrl={tenant?.widgetIconUrl ?? null}
                widgetShape={tenant?.widgetShape ?? "circle"}
                widgetBorderColor={tenant?.widgetBorderColor ?? null}
              />
            </div>
          </details>
        </Card>

        <Card className="flex flex-wrap items-center gap-3 p-4 opacity-70">
          <AtSign size={18} aria-hidden className="text-white/50" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white/80">Instagram Direct</span>
            <span className="block text-xs text-white/50">
              Responder mensagens do Direct com o mesmo agente.
            </span>
          </span>
          <Badge>em breve</Badge>
        </Card>
      </section>
        </>
      )}
    </div>
  );
}
