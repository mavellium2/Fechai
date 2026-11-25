import { requireSuperadmin } from "@/lib/session";
import { AI_MODELS, getActiveModel, getAiSettingMeta } from "@/modules/ai";
import { activeEmbeddingModel } from "@/modules/ai/embeddings";
import type { ProviderKey } from "@/modules/ai/types";
import { getUsageOverview, PROVIDER_ENV_KEY } from "@/modules/ai/usage";
import { listCredentials } from "@/modules/ai/credentials";
import { getCooldownMinutes, listChainForAdmin } from "@/modules/ai/chain";
import { Alert } from "@/components/ui/alert";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { ModelPicker } from "./ModelPicker";
import { ModelTest } from "./ModelTest";
import { FallbackChain } from "./FallbackChain";
import { CredentialsManager } from "./CredentialsManager";
import { CooldownSetting } from "./CooldownSetting";
import { UsagePanel } from "./UsagePanel";

const ALL_PROVIDERS: ProviderKey[] = ["gemini", "openai", "grok", "groq", "custom"];

const TABS = [
  { key: "resposta", label: "Quem responde" },
  { key: "chaves", label: "Chaves" },
  { key: "uso", label: "Uso" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/**
 * Painel de IA da plataforma.
 *
 * Era uma coluna com sete seções empilhadas — modelo ativo, teste, uso,
 * sequência, chaves, quarentena e catálogo — sem hierarquia entre elas, o que
 * deixava o principal ("quem atende meus leads agora?") no mesmo peso do
 * acessório. Agora são três abas, uma por pergunta:
 *
 * - **Quem responde** — a sequência, o teste e o que fazer quando falha.
 * - **Chaves** — as credenciais dos provedores.
 * - **Uso** — consumo de tokens e o catálogo de modelos.
 */
export default async function AdminIaPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  await requireSuperadmin();
  const { aba } = await searchParams;
  const tab: Tab = (TABS as readonly { key: string }[]).some((t) => t.key === aba)
    ? (aba as Tab)
    : "resposta";

  const [active, meta, usage, credentials, chainRows, cooldownMinutes] = await Promise.all([
    getActiveModel(),
    getAiSettingMeta(),
    getUsageOverview(),
    listCredentials(),
    listChainForAdmin(),
    getCooldownMinutes(),
  ]);

  // A chave vive só no servidor — mandamos ao client apenas "existe ou não".
  const models = AI_MODELS.map((m) => ({ ...m, keyConfigured: Boolean(process.env[m.envKey]) }));
  const embedding = activeEmbeddingModel();
  const keyConfigured = Object.fromEntries(
    ALL_PROVIDERS.map((p) => [p, Boolean(PROVIDER_ENV_KEY[p] && process.env[PROVIDER_ENV_KEY[p]])]),
  ) as Record<ProviderKey, boolean>;

  /**
   * O que pode entrar num degrau: os modelos do catálogo cujo provedor tem
   * chave (no `.env` OU cadastrada no painel) e os provedores personalizados.
   *
   * Modelo sem chave nenhuma sai da lista — oferecê-lo só produz um degrau que
   * falha na primeira chamada.
   */
  const hasKeyInPanel = new Set(credentials.map((c) => c.provider));
  const chainModels = [
    ...AI_MODELS.filter(
      (m) => Boolean(process.env[m.envKey]) || hasKeyInPanel.has(m.provider),
    ).map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      envConfigured: Boolean(process.env[m.envKey]),
    })),
    // Um "modelo" por credencial personalizada: o nome do modelo é dela.
    ...credentials
      .filter((c) => c.provider === "custom" && c.modelId)
      .map((c) => ({
        id: c.modelId!,
        label: `${c.label} · ${c.modelId}`,
        provider: "custom",
        envConfigured: false,
        custom: true,
      })),
  ];

  // O primeiro degrau LIGADO é quem atende de fato — não o "modelo ativo" do
  // catálogo, que é só o padrão de quem nunca montou uma sequência.
  const firstStep = chainRows.find((r) => r.enabled);
  const firstModel = chainModels.find((m) => m.id === firstStep?.modelId);
  const firstLabel = firstModel?.label ?? active.label;
  const firstKeyOk = firstStep?.credentialId
    ? true
    : firstModel
      ? firstModel.envConfigured
      : Boolean(process.env[active.envKey]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Inteligência artificial"
        description="Quem responde os leads de todos os tenants, e com qual chave."
      />

      <FilterTabs
        accent="signal"
        label="Seções do painel de IA"
        options={TABS.map((t) => ({ key: t.key, label: t.label }))}
        active={tab}
        href={(key) => (key === "resposta" ? "/admin/ia" : `/admin/ia?aba=${key}`)}
      />

      {!firstKeyOk && (
        <Alert tone="warn">
          O primeiro da sequência ({firstLabel}) está sem chave — o agente responde em modo
          demonstração até que uma seja configurada.
        </Alert>
      )}

      {tab === "resposta" && (
        <>
          {/* Duas colunas: a sequência é a configuração e ocupa o espaço; o
              teste e a quarentena são o que se faz COM ela, e ficam ao lado
              em vez de empurrar a sequência para fora da tela. */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <FallbackChain initial={chainRows} models={chainModels} credentials={credentials} />
            <div className="space-y-6">
              <ModelTest />
              <CooldownSetting minutes={cooldownMinutes} />
            </div>
          </div>
        </>
      )}

      {tab === "chaves" && <CredentialsManager credentials={credentials} />}

      {tab === "uso" && (
        <div className="space-y-8">
          <UsagePanel
            providers={usage.providers}
            historicalEstimateTokens={usage.historicalEstimateTokens}
            keyConfigured={keyConfigured}
          />

          <section>
            <h2 className="font-display text-lg font-semibold text-white">Catálogo de modelos</h2>
            <p className="mb-4 mt-1 text-sm text-white/50">
              O escolhido aqui é o padrão de quem ainda não montou uma sequência.
              {embedding && ` Embeddings: ${embedding}.`}
              {meta &&
                ` Última troca em ${meta.updatedAt.toLocaleDateString("pt-BR")}${meta.updatedBy ? ` por ${meta.updatedBy}` : ""}.`}
            </p>
            <ModelPicker models={models} activeId={active.id} />
          </section>
        </div>
      )}
    </div>
  );
}
