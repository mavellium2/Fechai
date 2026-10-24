/**
 * Catálogo de eventos auditáveis.
 *
 * Fonte única: a chave é o que vai para o banco, e o rótulo é o que a tela
 * mostra. Sem isto, o mesmo evento apareceria escrito de três jeitos (o texto
 * do log, o texto do filtro, o texto do detalhe) e o filtro por evento seria
 * uma lista digitada à mão que envelhece sozinha.
 *
 * `revertible` é a fonte da verdade para o botão de desfazer — a tela consulta
 * daqui e `revertAuditLog` confirma de novo no servidor.
 */

/** Natureza do evento. Decide como reverter e como a tela o pinta. */
export type AuditKind = "create" | "update" | "delete" | "auth" | "access";

export type AuditEventDef = {
  /** Frase curta em pt-BR, no passado. Aparece na linha do log. */
  label: string;
  kind: AuditKind;
  /** Agrupador para o filtro da tela. */
  group: AuditGroup;
  /**
   * Aceita desfazer. Só `update` e `delete` podem ser true: um login não tem
   * o que regravar, e "create" se desfaz excluindo — o que seria destrutivo
   * disfarçado de undo.
   */
  revertible?: boolean;
};

export const AUDIT_GROUPS = {
  auth: "Acesso",
  conta: "Conta",
  agente: "Agente",
  conhecimento: "Base de conhecimento",
  contatos: "Contatos",
  integracoes: "Integrações",
  admin: "Admin",
} as const;

export type AuditGroup = keyof typeof AUDIT_GROUPS;

/**
 * Os eventos. A chave é `dominio.acao` e nunca muda depois de gravada em
 * produção — renomear uma chave órfã as linhas antigas, que passariam a
 * aparecer como evento desconhecido.
 */
export const AUDIT_EVENTS = {
  "scheduling.qr_risk_accepted": { label: "Aceitou os riscos das confirmações pela Evolution", kind: "update", group: "integracoes" },
  "report.monthly_saved": { label: "Revisou as premissas do ROI mensal", kind: "update", group: "admin" },
  "report.lead_value_saved": { label: "Definiu ou corrigiu o valor do lead", kind: "update", group: "conta" },
  "report.monthly_finalized": { label: "Fechou o relatório mensal", kind: "update", group: "admin" },
  "report.monthly_reopened": { label: "Reabriu o relatório mensal", kind: "update", group: "admin" },
  "report.monthly_delivered": { label: "Registrou envio ou reunião do relatório", kind: "update", group: "admin" },
  "report.monthly_pendency_updated": { label: "Atualizou uma pendência do relatório mensal", kind: "update", group: "admin" },
  "report.monthly_pendencies_requested": { label: "Registrou a solicitação de pendências à clínica", kind: "update", group: "admin" },
  // ── acesso ────────────────────────────────────────────────────────────
  "auth.login": { label: "Entrou na conta", kind: "auth", group: "auth" },
  "auth.login_failed": { label: "Falha ao entrar", kind: "auth", group: "auth" },
  "auth.logout": { label: "Saiu da conta", kind: "auth", group: "auth" },
  "auth.password_changed": { label: "Trocou a senha", kind: "update", group: "auth" },
  "auth.password_reset": { label: "Redefiniu a senha por e-mail", kind: "update", group: "auth" },
  "auth.google_linked": { label: "Vinculou a conta Google", kind: "update", group: "auth" },

  // ── conta (o cliente mexendo na própria conta) ────────────────────────
  "account.created": { label: "Conta criada", kind: "create", group: "conta" },
  "account.profile_updated": {
    label: "Atualizou os dados do perfil",
    kind: "update",
    group: "conta",
    revertible: true,
  },
  "account.roles_updated": {
    label: "Mudou os papéis da conta",
    kind: "update",
    group: "conta",
    revertible: true,
  },
  "account.service_area_updated": {
    label: "Atualizou a área de atendimento",
    kind: "update",
    group: "conta",
  },
  "account.onboarding_completed": {
    label: "Concluiu o onboarding",
    kind: "update",
    group: "conta",
  },

  // ── agente ────────────────────────────────────────────────────────────
  "agent.created": { label: "Criou um agente", kind: "create", group: "agente" },
  "agent.updated": {
    label: "Alterou o agente",
    kind: "update",
    group: "agente",
    revertible: true,
  },
  "agent.persona_updated": {
    label: "Alterou a persona do agente",
    kind: "update",
    group: "agente",
    revertible: true,
  },
  "agent.rules_updated": {
    label: "Alterou as regras do agente",
    kind: "update",
    group: "agente",
    revertible: true,
  },
  "agent.behavior_updated": {
    label: "Mudou um comportamento do agente",
    kind: "update",
    group: "agente",
    revertible: true,
  },
  "agent.voice_style_updated": {
    label: "Mudou o jeito de falar do agente",
    kind: "update",
    group: "agente",
    revertible: true,
  },
  "agent.voice_prompt_updated": {
    label: "Mudou as instruções de fala do agente",
    kind: "update",
    group: "agente",
    revertible: true,
  },
  "agent.speech_blocklist_updated": {
    label: "Mudou o que o agente não fala em áudio",
    kind: "update",
    group: "agente",
    revertible: true,
  },
  "agent.action_toggled": {
    label: "Ligou/desligou uma ação do agente",
    kind: "update",
    group: "agente",
    revertible: true,
  },
  "agent.voice_updated": {
    label: "Mudou a voz do agente",
    kind: "update",
    group: "agente",
    // A voz gravada some da Fish Audio quando substituída: regravar o
    // `voiceId` antigo apontaria para um modelo que não existe mais.
  },
  "agent.deleted": {
    label: "Excluiu um agente",
    kind: "delete",
    group: "agente",
    revertible: true,
  },

  // ── base de conhecimento ──────────────────────────────────────────────
  "knowledge.added": { label: "Adicionou um documento", kind: "create", group: "conhecimento" },
  "knowledge.updated": {
    label: "Editou um documento",
    kind: "update",
    group: "conhecimento",
    revertible: true,
  },
  "knowledge.deleted": {
    label: "Removeu um documento",
    kind: "delete",
    group: "conhecimento",
    revertible: true,
  },
  // Fila de perguntas sem resposta (P-87). Aprovar grava um documento na base.
  "knowledge.gap_answered": { label: "Aprovou a resposta de uma pergunta sem resposta", kind: "update", group: "conhecimento" },
  "knowledge.gap_dismissed": { label: "Descartou uma pergunta sem resposta", kind: "update", group: "conhecimento" },
  "knowledge.gap_reopened": { label: "Devolveu uma pergunta à fila", kind: "update", group: "conhecimento" },
  "knowledge.gap_resumed": { label: "Retomou contatos com a resposta aprovada", kind: "update", group: "conhecimento" },
  "knowledge.gap_settings_updated": { label: "Alterou a regra e os avisos das perguntas sem resposta", kind: "update", group: "conhecimento" },

  // Pesquisa de satisfação pós-conversa.
  "survey.settings_updated": { label: "Alterou a pesquisa de satisfação", kind: "update", group: "conta" },
  "survey.test_sent": { label: "Enviou um teste da pesquisa de satisfação", kind: "create", group: "conta" },

  // ── contatos / agenda ─────────────────────────────────────────────────
  "lead.created": { label: "Cadastrou um contato", kind: "create", group: "contatos" },
  "lead.updated": {
    label: "Alterou um contato",
    kind: "update",
    group: "contatos",
    revertible: true,
  },
  "lead.deleted": {
    label: "Excluiu um contato",
    kind: "delete",
    group: "contatos",
    revertible: true,
  },
  "appointment.cancelled": {
    label: "Cancelou um agendamento",
    kind: "update",
    group: "contatos",
  },

  // ── integrações ───────────────────────────────────────────────────────
  "whatsapp.connected": { label: "Conectou o WhatsApp", kind: "update", group: "integracoes" },
  "whatsapp.disconnected": {
    label: "Desconectou o WhatsApp",
    kind: "update",
    group: "integracoes",
  },
  "integration.saved": {
    label: "Salvou credenciais de integração",
    kind: "update",
    group: "integracoes",
    // Nunca revertível: o snapshot é redigido (ver redact.ts), então o
    // `before` não tem o segredo para regravar — e não deveria ter.
  },
  "integration.removed": {
    label: "Removeu uma integração",
    kind: "delete",
    group: "integracoes",
  },
  "integration.toggled": {
    label: "Ligou/desligou uma integração",
    kind: "update",
    group: "integracoes",
    revertible: true,
  },

  // ── admin (o superadmin agindo sobre contas) ──────────────────────────
  "admin.tenant_suspended": {
    label: "Suspendeu a conta",
    kind: "update",
    group: "admin",
    revertible: true,
  },
  "admin.tenant_reactivated": {
    label: "Reativou a conta",
    kind: "update",
    group: "admin",
    revertible: true,
  },
  "admin.plan_changed": {
    label: "Trocou o plano da conta",
    kind: "update",
    group: "admin",
    revertible: true,
  },
  "admin.usage_limit_changed": {
    label: "Alterou a cota de mensagens",
    kind: "update",
    group: "admin",
    revertible: true,
  },
  "admin.price_override_changed": {
    label: "Alterou o preço cobrado da conta",
    kind: "update",
    group: "admin",
    revertible: true,
  },
  "admin.trial_changed": {
    label: "Alterou o período de teste",
    kind: "update",
    group: "admin",
    revertible: true,
  },
  "admin.meta_whatsapp_access_changed": {
    label: "Alterou o acesso à API oficial da Meta",
    kind: "update",
    group: "admin",
  },
  "admin.evolution_whatsapp_access_changed": {
    label: "Alterou o acesso ao WhatsApp por QR (Evolution)",
    kind: "update",
    group: "admin",
  },
  "admin.account_created": { label: "Criou uma conta pelo painel", kind: "create", group: "admin" },
  "admin.gap_responders_changed": { label: "Definiu quem responde a fila de perguntas", kind: "update", group: "admin" },
  "admin.tenant_export_requested": { label: "Solicitou download dos dados da conta", kind: "access", group: "admin" },
  "admin.tenant_deleted": {
    label: "Excluiu a conta definitivamente",
    kind: "delete",
    group: "admin",
    // Irreversível de propósito: cascade em dezenas de tabelas + recursos
    // soltos em três serviços externos. Ver README, seção "Reverter".
  },
  // Bloqueio de IP. Revertível pelo caminho normal da trilha seria estranho —
  // "desfazer" um bloqueio é desbloquear, e isso tem botão próprio na lista de
  // bloqueados, com o motivo à vista. Aqui ficam só os fatos.
  "admin.ip_blocked": { label: "Bloqueou um IP", kind: "create", group: "admin" },
  "admin.ip_unblocked": { label: "Desbloqueou um IP", kind: "delete", group: "admin" },

  // Tokens da rota MCP do agente. Nunca revertíveis: revogar não se desfaz
  // (emite-se outro token) e o token em claro não existe para ser regravado.
  "mcp.token_issued": { label: "Emitiu um token de acesso MCP", kind: "create", group: "admin" },
  "mcp.token_revoked": { label: "Revogou um token de acesso MCP", kind: "update", group: "admin" },

  "admin.impersonated": { label: "Entrou como o cliente", kind: "access", group: "admin" },
  "admin.impersonation_ended": { label: "Saiu do modo cliente", kind: "access", group: "admin" },
  "admin.agent_replicated": {
    label: "Replicou um agente entre empresas",
    kind: "create",
    group: "admin",
  },
  "admin.ai_model_changed": { label: "Trocou o modelo de IA", kind: "update", group: "admin" },
  "admin.ai_credential_added": {
    label: "Adicionou uma credencial de IA",
    kind: "create",
    group: "admin",
  },
  "admin.ai_credential_removed": {
    label: "Removeu uma credencial de IA",
    kind: "delete",
    group: "admin",
  },
  "admin.feedback_status": { label: "Mudou a situação de um feedback", kind: "update", group: "admin" },
  "admin.revert": {
    label: "Desfez um evento",
    kind: "update",
    group: "admin",
    // Desfazer o desfazer é possível pela linha ORIGINAL, não por esta —
    // encadear reversões de reversões vira um histórico impossível de ler.
  },
} as const satisfies Record<string, AuditEventDef>;

export type AuditEvent = keyof typeof AUDIT_EVENTS;

export function eventDef(event: string): AuditEventDef | null {
  return (AUDIT_EVENTS as Record<string, AuditEventDef>)[event] ?? null;
}

/** Rótulo em pt-BR. Evento fora do catálogo (linha antiga) cai na própria chave. */
export function eventLabel(event: string): string {
  return eventDef(event)?.label ?? event;
}

export function isRevertibleEvent(event: string): boolean {
  return eventDef(event)?.revertible === true;
}

/** Eventos agrupados, para montar o filtro da tela sem lista paralela. */
export function eventsByGroup(): { group: AuditGroup; label: string; events: string[] }[] {
  const groups = Object.keys(AUDIT_GROUPS) as AuditGroup[];
  return groups.map((group) => ({
    group,
    label: AUDIT_GROUPS[group],
    events: Object.entries(AUDIT_EVENTS)
      .filter(([, def]) => def.group === group)
      .map(([key]) => key),
  }));
}
