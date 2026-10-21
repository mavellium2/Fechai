"use client";

import { useRef, useState, useTransition } from "react";
import { Eye, Settings2, ShieldAlert, Trash2 } from "lucide-react";
import type { PlanKey } from "@prisma/client";
import { PLANS, planOf } from "@/modules/billing/plans";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { SidePanel } from "@/components/ui/side-panel";
import { Switch } from "@/components/ui/switch";
import { FormFeedback } from "@/components/ui/alert";
import { TenantDownloadButton } from "./TenantDownloadButton";
import {
  suspendTenant,
  changePlan,
  setTenantUsageLimit,
  setTenantPriceOverride,
  setTenantTrial,
  impersonateUser,
  deleteTenantAccount,
  setTenantMetaWhatsappEnabled,
  setTenantEvolutionWhatsappEnabled,
} from "../../actions";

type Props = {
  id: string;
  name: string;
  planKey: PlanKey;
  status: string;
  whatsappStatus: string;
  /** Se o superadmin liberou a alternativa oficial da Meta para esta conta. */
  metaWhatsappEnabled: boolean;
  /** Se o WhatsApp por QR (Evolution) está liberado; o admin desliga para bloquear a conta. */
  evolutionWhatsappEnabled: boolean;
  /** Cota de mensagens/mês fixada fora do padrão do plano (null = usa o plano). */
  messageLimitOverride: number | null;
  priceCentsOverride: number | null;
  /** Fim do período de teste (ISO); null = sem teste em andamento. */
  trialEndsAt: string | null;
  /** O plano da conta é de teste por tempo (hoje só o grátis). */
  planIsTrial: boolean;
  /** Tenant que contém um SUPERADMIN — conta de plataforma, não cliente. */
  isAdminAccount?: boolean;
  /** Usuário usado ao clicar em "Ver como" (dono da conta). */
  ownerUserId?: string;
  createdAt: string;
  counts: { users: number; leads: number; conversations: number };
};

const WHATSAPP_PT: Record<string, string> = {
  connected: "conectado",
  pending_qr: "aguardando QR",
  disconnected: "desconectado",
};

/** Ponto de status do WhatsApp: cor + texto, nunca só cor (design-ui, §4). */
const WHATSAPP_DOT: Record<string, string> = {
  connected: "bg-success",
  pending_qr: "bg-warn",
  disconnected: "bg-white/25",
};

/**
 * Uma conta na tabela do admin: linha de leitura + painel de edição.
 *
 * Antes cada linha trazia os cinco controles abertos (select de plano, campo de
 * cota, botões de teste, personificar e suspender), o que dava ~140px por
 * conta, cinquenta controles numa lista de dez e uma tabela que rolava de lado.
 * O admin edita uma conta por vez: a linha voltou a ser leitura e a edição
 * mudou para um `SidePanel`, onde cada campo tem rótulo e explicação.
 *
 * O estado de edição (plano e cota digitados) vive aqui, não no painel, para
 * não se perder caso o painel feche — e é reposto ao abrir.
 */
/** Centavos → "199,00" para o campo de edição. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * "199", "199,90" ou "1.234,56" → centavos. `null` = inválido (o chamador
 * mostra o erro). Zero é válido: conta cortesia existe.
 */
function inputToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function TenantRow(t: Props) {
  const [pending, start] = useTransition();
  const [panelOpen, setPanelOpen] = useState(false);
  const [plan, setPlan] = useState<PlanKey>(t.planKey);
  const [limitInput, setLimitInput] = useState<string>(
    String(t.messageLimitOverride ?? planOf(t.planKey).messagesPerMonth),
  );
  const suspended = t.status === "suspended";
  const planDirty = plan !== t.planKey;
  // Em reais com vírgula, como o admin digita. A conversão para centavos é na
  // hora de salvar — guardar centavos aqui obrigaria a formatar a cada tecla.
  const [priceInput, setPriceInput] = useState<string>(() =>
    centsToInput(t.priceCentsOverride ?? planOf(t.planKey).priceCents),
  );
  const [impError, setImpError] = useState<string | null>(null);
  const [metaAccessError, setMetaAccessError] = useState<string | null>(null);
  const [metaAccessInfo, setMetaAccessInfo] = useState<string | null>(null);
  const [evolutionAccessError, setEvolutionAccessError] = useState<string | null>(null);
  const [evolutionAccessInfo, setEvolutionAccessInfo] = useState<string | null>(null);

  // Exclusão definitiva: diálogo próprio (em vez de ConfirmButton) porque aqui
  // não basta um "confirmar" — o admin digita o nome da conta. A lista tem
  // nomes parecidos e não há desfazer.
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteArmed = deleteTyped.trim() === t.name.trim();

  function openDelete() {
    setDeleteTyped("");
    setDeleteError(null);
    deleteDialog.current?.showModal();
  }

  function confirmDelete() {
    if (!deleteArmed) return;
    setDeleteError(null);
    start(async () => {
      const result = await deleteTenantAccount(t.id);
      if (result?.ok) {
        deleteDialog.current?.close();
        return;
      }
      // A conta continua na lista: mostra o motivo no próprio diálogo, onde o
      // admin está olhando, em vez de fechar como se tivesse dado certo.
      setDeleteError(result?.error ?? "Não foi possível excluir a conta.");
    });
  }

  function impersonate(userId: string) {
    setImpError(null);
    start(async () => {
      const result = await impersonateUser(userId);
      if (result && !result.ok) setImpError(result.error ?? "Não foi possível personificar.");
    });
  }

  const planDefault = planOf(t.planKey).messagesPerMonth;
  const limitValue = Math.trunc(Number(limitInput));
  const limitInvalid = !Number.isInteger(limitValue) || limitValue < 0;
  const limitDirty = limitInvalid || limitValue !== (t.messageLimitOverride ?? planDefault);
  const effectiveLimit = t.messageLimitOverride ?? planDefault;

  const trialUntil = t.trialEndsAt ? new Date(t.trialEndsAt) : null;
  const trialActive = Boolean(trialUntil && trialUntil > new Date());
  const trialDaysLeft = trialActive
    ? Math.ceil((trialUntil!.getTime() - new Date().getTime()) / 86_400_000)
    : 0;

  const planPriceCents = planOf(t.planKey).priceCents;
  const priceCents = inputToCents(priceInput);
  const priceInvalid = priceCents === null;
  const priceDirty = priceInvalid || priceCents !== (t.priceCentsOverride ?? planPriceCents);

  function savePrice() {
    if (priceCents === null) return;
    // Igual ao preço de tabela não vira override — volta a seguir o plano,
    // e assim um reajuste futuro do plano alcança a conta sozinho.
    start(() => setTenantPriceOverride(t.id, priceCents === planPriceCents ? null : priceCents));
  }

  function saveLimits() {
    if (limitInvalid) return;
    // Valor igual ao padrão do plano não precisa virar override — volta a seguir o plano.
    start(() => setTenantUsageLimit(t.id, limitValue === planDefault ? null : limitValue));
  }

  function toggleMetaAccess(enabled: boolean) {
    setMetaAccessError(null);
    setMetaAccessInfo(null);
    start(async () => {
      const result = await setTenantMetaWhatsappEnabled(t.id, enabled);
      if (!result.ok) setMetaAccessError(result.error ?? "Não foi possível alterar o acesso.");
      else setMetaAccessInfo(result.info ?? null);
    });
  }

  function toggleEvolutionAccess(enabled: boolean) {
    setEvolutionAccessError(null);
    setEvolutionAccessInfo(null);
    start(async () => {
      const result = await setTenantEvolutionWhatsappEnabled(t.id, enabled);
      if (!result.ok) setEvolutionAccessError(result.error ?? "Não foi possível alterar o acesso.");
      else setEvolutionAccessInfo(result.info ?? null);
    });
  }

  // Reabre sempre com o que está gravado: um valor digitado e não salvo numa
  // visita anterior não pode reaparecer como se fosse o estado da conta.
  function openPanel() {
    setPlan(t.planKey);
    setLimitInput(String(t.messageLimitOverride ?? planDefault));
    setPriceInput(centsToInput(t.priceCentsOverride ?? planOf(t.planKey).priceCents));
    setImpError(null);
    setPanelOpen(true);
  }

  const canImpersonate = Boolean(t.ownerUserId) && !t.isAdminAccount;

  return (
    <tr className={`border-t border-white/5 ${suspended ? "bg-danger/10" : ""}`}>
      <td className="px-4 py-2.5">
        <p className="flex flex-wrap items-center gap-2 font-medium text-white">
          {t.name}
          {t.isAdminAccount && <Badge tone="signal">admin</Badge>}
          {/* Teste em curso ao lado do nome: é o que decide se a conta responde
              hoje, então precisa ser visível sem abrir o painel. */}
          {t.planIsTrial && trialActive && (
            <Badge tone="signal">
              teste · {trialDaysLeft}d
            </Badge>
          )}
          {t.planIsTrial && !trialActive && <Badge tone="danger">teste encerrado</Badge>}
        </p>
        <p className="font-mono text-micro uppercase tracking-wide text-white/45">
          {t.counts.users} usr · {t.counts.leads} leads · {t.counts.conversations} conv ·{" "}
          {t.createdAt}
        </p>
      </td>

      {/* Preço personalizado aparece sob o plano: quem varre a lista precisa
          ver que o valor daquela conta não é o de tabela, senão o ROI do
          relatório dela parece errado sem explicação. */}
      <td className="px-4 py-2.5 text-white/80">
        {planOf(t.planKey).name}
        {t.priceCentsOverride != null && (
          <span className="mt-0.5 block font-mono text-micro uppercase tracking-wide text-signal">
            R$ {centsToInput(t.priceCentsOverride)}/mês
          </span>
        )}
      </td>

      {/* Cota em texto: o override é a exceção, e só ele merece destaque. */}
      <td className="px-4 py-2.5">
        <span className="font-mono text-xs tabular-nums text-white/80">
          {effectiveLimit.toLocaleString("pt-BR")}
        </span>
        <span className="ml-1 font-mono text-micro uppercase tracking-wide text-white/40">
          msg/mês
        </span>
        {t.messageLimitOverride != null && (
          <span className="ml-1.5 font-mono text-micro uppercase tracking-wide text-signal">
            ajustado
          </span>
        )}
      </td>

      <td className="px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-micro uppercase tracking-wide text-white/60">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${WHATSAPP_DOT[t.whatsappStatus] ?? "bg-white/25"}`}
          />
          {WHATSAPP_PT[t.whatsappStatus] ?? t.whatsappStatus}
        </span>
        {!t.evolutionWhatsappEnabled && (
          <span className="ml-1.5 font-mono text-micro uppercase tracking-wide text-signal">
            QR desligado
          </span>
        )}
      </td>

      <td className="px-4 py-2.5">
        <Badge tone={suspended ? "danger" : "success"}>{suspended ? "Suspenso" : "Ativo"}</Badge>
      </td>

      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {/*
            "Ver como" na própria linha: entrar no painel do cliente é a forma
            real de inspecionar uma conta (vê o que ela vê), e passava por abrir
            o painel antes — três cliques para o que é o atalho mais usado.
            Continua também no rodapé do painel, onde já se está com a conta
            aberta. Suspensa ou conta de admin, a action recusa: o botão fica
            desabilitado com o motivo no `title`.
          */}
          <Button
            size="icon"
            variant="ghost"
            disabled={pending || !canImpersonate || suspended}
            title={
              t.isAdminAccount
                ? "Conta do admin — não é possível personificar"
                : suspended
                  ? "Conta suspensa — reative antes de ver como"
                  : t.ownerUserId
                    ? `Entrar no painel como ${t.name}`
                    : "Conta sem usuário para personificar"
            }
            aria-label={`Ver o painel como ${t.name}`}
            onClick={() => t.ownerUserId && impersonate(t.ownerUserId)}
          >
            <Eye size={15} aria-hidden />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            aria-label={`Gerenciar ${t.name}`}
            onClick={openPanel}
          >
            <Settings2 size={15} aria-hidden />
            Gerenciar
          </Button>
        </div>

        {/* O erro de personificação nasce na linha agora — precisa aparecer
            aqui, não só dentro do painel que pode estar fechado. */}
        {impError && !panelOpen && (
          <p role="alert" className="mt-1 text-right font-mono text-micro text-danger">
            {impError}
          </p>
        )}

        <SidePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          title={t.name}
          subtitle={
            <span className="font-mono text-micro uppercase tracking-wide">
              {t.counts.users} usr · {t.counts.leads} leads · {t.counts.conversations} conv · desde{" "}
              {t.createdAt}
            </span>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Mesma regra do botão da linha: a action recusa personificar
                  conta suspensa, então a tela não oferece. */}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !canImpersonate || suspended}
                title={
                  t.isAdminAccount
                    ? "Conta do admin — não é possível personificar"
                    : suspended
                      ? "Conta suspensa — reative antes de ver como"
                      : t.ownerUserId
                        ? "Entrar no painel como essa conta"
                        : "Conta sem usuário para personificar"
                }
                onClick={() => t.ownerUserId && impersonate(t.ownerUserId)}
              >
                <Eye size={15} aria-hidden />
                Ver como
              </Button>
              {!t.isAdminAccount && <ButtonLink href={`/admin/relatorios/${t.id}`} variant="outline" size="sm">Relatórios</ButtonLink>}

              <div className="flex items-center gap-2">
                <ConfirmButton
                  size="sm"
                  variant={suspended ? "outline" : "destructive"}
                  disabled={pending}
                  confirm={
                    suspended
                      ? {
                          title: `Reativar ${t.name}?`,
                          description:
                            "A conta volta a acessar o painel e o agente volta a responder os leads.",
                          confirmLabel: "Reativar conta",
                        }
                      : {
                          title: `Suspender ${t.name}?`,
                          description:
                            "A pessoa é bloqueada do painel na próxima navegação e o agente para de atender. Dá para reativar depois.",
                          confirmLabel: "Suspender conta",
                          tone: "danger",
                        }
                  }
                  onConfirm={() => start(() => suspendTenant(t.id, !suspended))}
                >
                  {suspended ? "Reativar" : "Suspender"}
                </ConfirmButton>

                {/* Só depois de suspensa — conta de admin inclusive. A action
                    revalida no servidor (e recusa se for a última conta de
                    admin da plataforma); isto é só a tela. */}
                {suspended && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    title="Excluir esta conta e todos os seus dados, definitivamente"
                    onClick={openDelete}
                  >
                    <Trash2 size={15} aria-hidden />
                    Excluir
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-6">
            <TenantDownloadButton tenantId={t.id} />
            {impError && (
              <p role="alert" className="font-mono text-micro text-danger">
                {impError}
              </p>
            )}

            {/*
              Antes o `onChange` do select gravava direto. Além de não ter
              confirmação, no teclado isso troca o plano do cliente a cada seta:
              o navegador dispara `change` em cada opção percorrida. Agora a
              troca só vai ao servidor quando o admin confirma.
            */}
            <section>
              <label
                htmlFor={`${t.id}-plano`}
                className="block text-sm font-medium text-white/85"
              >
                Plano
              </label>
              <p className="mt-1 text-sm text-white/50">
                Define a cota padrão e o que a conta pode usar.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                  id={`${t.id}-plano`}
                  size="sm"
                  value={plan}
                  disabled={pending}
                  onChange={(e) => setPlan(e.target.value as PlanKey)}
                  className="w-40"
                >
                  {PLANS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                </Select>

                {planDirty && (
                  <>
                    <Button
                      size="sm"
                      loading={pending}
                      loadingLabel="Salvando plano"
                      onClick={() => start(() => changePlan(t.id, plan))}
                    >
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setPlan(t.planKey)}
                    >
                      Desfazer
                    </Button>
                  </>
                )}
              </div>
            </section>

            <section className="border-t border-white/10 pt-5">
              <label
                htmlFor={`${t.id}-mensagens`}
                className="block text-sm font-medium text-white/85"
              >
                Cota de mensagens
              </label>
              <p className="mt-1 text-sm text-white/50">
                Respostas da IA por mês. O padrão do plano {planOf(t.planKey).name} é{" "}
                {planDefault.toLocaleString("pt-BR")}.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id={`${t.id}-mensagens`}
                  type="number"
                  min={0}
                  step={1}
                  value={limitInput}
                  disabled={pending}
                  aria-invalid={limitInvalid || undefined}
                  onChange={(e) => setLimitInput(e.target.value)}
                  className="w-28 rounded-control border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-white focus:border-iris focus:outline-none focus-visible:ring-2 focus-visible:ring-iris aria-invalid:border-danger"
                />
                <span className="font-mono text-micro uppercase tracking-wide text-white/55">
                  msg/mês
                </span>

                {limitDirty && (
                  <>
                    <Button
                      size="sm"
                      loading={pending}
                      loadingLabel="Salvando cota"
                      disabled={limitInvalid}
                      onClick={saveLimits}
                    >
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setLimitInput(String(t.messageLimitOverride ?? planDefault))}
                    >
                      Desfazer
                    </Button>
                  </>
                )}
              </div>

              {limitInvalid && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  Informe um número inteiro de 0 para cima.
                </p>
              )}

              {t.messageLimitOverride != null && !limitDirty && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(() => setTenantUsageLimit(t.id, null))}
                  className="mt-2 font-mono text-micro uppercase tracking-wide text-white/55 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                >
                  restaurar padrão do plano
                </button>
              )}
            </section>

            {/* Preço cobrado: override só do VALOR. Serve para desconto
                negociado ou cortesia sem ter de mexer no plano (que mudaria a
                cota junto). Só afeta o "Investido"/ROI de /relatorios. */}
            <section className="border-t border-white/10 pt-5">
              <label
                htmlFor={`${t.id}-preco`}
                className="font-mono text-micro uppercase tracking-wide text-white/55"
              >
                Preço cobrado
              </label>
              <p className="mt-1 text-sm text-white/50">
                O que esta conta paga por mês. O padrão do plano{" "}
                {planOf(t.planKey).name} é {planOf(t.planKey).priceLabel}. Muda só o
                relatório financeiro do cliente — a cota continua vindo do plano.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-micro uppercase tracking-wide text-white/55">
                  R$
                </span>
                <input
                  id={`${t.id}-preco`}
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  disabled={pending}
                  aria-invalid={priceInvalid || undefined}
                  onChange={(e) => setPriceInput(e.target.value)}
                  className="w-28 rounded-control border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-white focus:border-iris focus:outline-none focus-visible:ring-2 focus-visible:ring-iris aria-invalid:border-danger"
                />
                <span className="font-mono text-micro uppercase tracking-wide text-white/55">
                  /mês
                </span>

                {priceDirty && (
                  <>
                    <Button
                      size="sm"
                      loading={pending}
                      loadingLabel="Salvando preço"
                      disabled={priceInvalid}
                      onClick={savePrice}
                    >
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        setPriceInput(centsToInput(t.priceCentsOverride ?? planPriceCents))
                      }
                    >
                      Desfazer
                    </Button>
                  </>
                )}
              </div>

              {priceInvalid && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  Informe um valor como 199 ou 149,90.
                </p>
              )}

              {t.priceCentsOverride != null && !priceDirty && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(() => setTenantPriceOverride(t.id, null))}
                  className="mt-2 font-mono text-micro uppercase tracking-wide text-white/55 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                >
                  restaurar preço do plano
                </button>
              )}
            </section>

            {/* Período de teste: só faz sentido em plano de teste (grátis). Passada
                a data, a IA para e a conta só volta assinando. */}
            {t.planIsTrial && (
              <section className="border-t border-white/10 pt-5">
                <p className="text-sm font-medium text-white/85">Período de teste</p>
                <p className="mt-1 text-sm text-white/50">
                  {trialActive
                    ? "Enquanto durar, a IA responde dentro da cota. Encerrado, ela cala até a conta assinar."
                    : "A IA está calada nesta conta. Dar mais dias devolve o atendimento automático."}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {trialActive ? (
                    <>
                      <Badge tone="signal">
                        termina em {trialDaysLeft} dia{trialDaysLeft === 1 ? "" : "s"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => start(() => setTenantTrial(t.id, null))}
                      >
                        Encerrar agora
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge tone="danger">teste encerrado</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => start(() => setTenantTrial(t.id, 7))}
                      >
                        Dar +7 dias
                      </Button>
                    </>
                  )}
                </div>
              </section>
            )}

            <section className="border-t border-white/10 pt-5">
              <p className="text-sm font-medium text-white/85">WhatsApp</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/50">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${WHATSAPP_DOT[t.whatsappStatus] ?? "bg-white/25"}`}
                />
                {WHATSAPP_PT[t.whatsappStatus] ?? t.whatsappStatus}
              </p>
              <div className="mt-4 flex items-start justify-between gap-4 rounded-control border border-white/10 bg-white/[0.03] p-3">
                <div>
                  <p className="text-sm font-medium text-white/85">API oficial da Meta</p>
                  <p id={`${t.id}-meta-whatsapp-help`} className="mt-1 text-sm text-white/50">
                    Quando ligada, a conta pode conectar a API oficial em Integrações e mantê-la
                    junto com o número por QR code. Ao desligar, só a conexão Meta é interrompida.
                  </p>
                </div>
                <Switch
                  checked={t.metaWhatsappEnabled}
                  onCheckedChange={toggleMetaAccess}
                  loading={pending}
                  label={`${t.metaWhatsappEnabled ? "Desabilitar" : "Habilitar"} API oficial da Meta para ${t.name}`}
                  describedBy={`${t.id}-meta-whatsapp-help`}
                />
              </div>
              <FormFeedback error={metaAccessError} info={metaAccessInfo} />
              <div className="mt-3 flex items-start justify-between gap-4 rounded-control border border-white/10 bg-white/[0.03] p-3">
                <div>
                  <p className="text-sm font-medium text-white/85">WhatsApp por QR code (Evolution)</p>
                  <p id={`${t.id}-evolution-whatsapp-help`} className="mt-1 text-sm text-white/50">
                    Ao desligar, a conta para de receber e enviar pelo número do QR e não consegue
                    gerar novo QR. A sessão é mantida: ao ligar de novo, volta sem ler o QR outra vez.
                    A conexão Meta não é afetada.
                  </p>
                </div>
                <Switch
                  checked={t.evolutionWhatsappEnabled}
                  onCheckedChange={toggleEvolutionAccess}
                  loading={pending}
                  label={`${t.evolutionWhatsappEnabled ? "Desligar" : "Ligar"} WhatsApp por QR para ${t.name}`}
                  describedBy={`${t.id}-evolution-whatsapp-help`}
                />
              </div>
              <FormFeedback error={evolutionAccessError} info={evolutionAccessInfo} />
            </section>
          </div>
        </SidePanel>

        <dialog
          ref={deleteDialog}
          aria-labelledby={`${t.id}-excluir-titulo`}
          className="m-auto w-[calc(100%-2rem)] max-w-md rounded-surface border border-white/15 bg-ink p-6 text-left text-white backdrop:bg-ink/70"
          onClose={() => {
            setDeleteTyped("");
            setDeleteError(null);
          }}
        >
          <h2 id={`${t.id}-excluir-titulo`} className="font-display text-lg font-semibold">
            Excluir {t.name} definitivamente?
          </h2>

          {/* Conta de admin é outra conversa: quem apaga uma conta de cliente
              perde os dados de um cliente; quem apaga uma de admin tira o
              acesso ao painel de outra pessoa da equipe. O aviso é separado
              porque o parágrafo abaixo (leads, conversas) não descreve o que
              realmente está em jogo aqui. */}
          {t.isAdminAccount && (
            <p className="mt-3 flex gap-2 rounded-surface border border-warn/30 bg-warn/10 px-3 py-2 text-sm leading-relaxed text-white/80">
              <ShieldAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-warn" />
              <span>
                Esta é uma <strong className="text-white">conta de admin</strong>. Excluí-la remove
                o acesso dessa pessoa ao painel da plataforma. Se for a última conta de admin, a
                exclusão é recusada — ninguém ficaria com acesso ao /admin.
              </span>
            </p>
          )}

          <p className="mt-2 text-sm leading-relaxed text-white/65">
            Apaga a conta e tudo que pertence a ela: {t.counts.users} usuário
            {t.counts.users === 1 ? "" : "s"}, {t.counts.leads} lead
            {t.counts.leads === 1 ? "" : "s"}, {t.counts.conversations} conversa
            {t.counts.conversations === 1 ? "" : "s"} com todo o histórico, agentes, base de
            conhecimento, agendamentos e credenciais de integração. O WhatsApp é desconectado e os
            arquivos saem da CDN. <strong className="text-white">Não há como desfazer.</strong>
          </p>

          <label
            htmlFor={`${t.id}-excluir-nome`}
            className="mt-4 block font-mono text-micro uppercase tracking-wide text-white/55"
          >
            Digite <span className="text-white">{t.name}</span> para confirmar
          </label>
          <input
            id={`${t.id}-excluir-nome`}
            type="text"
            autoComplete="off"
            value={deleteTyped}
            disabled={pending}
            onChange={(e) => setDeleteTyped(e.target.value)}
            className="mt-1.5 w-full rounded-control border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          />

          {deleteError && (
            <p role="alert" className="mt-3 font-mono text-micro text-danger">
              {deleteError}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => deleteDialog.current?.close()}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteArmed}
              loading={pending}
              loadingLabel="Excluindo conta"
              onClick={confirmDelete}
            >
              Excluir para sempre
            </Button>
          </div>
        </dialog>
      </td>
    </tr>
  );
}
