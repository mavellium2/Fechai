# Módulo: audit

## O que faz

A trilha de auditoria da plataforma: **quem fez o quê, em qual conta, e como desfazer**. Alimenta a tela `/admin/logs`, onde o superadmin vê logins, o que os clientes alteraram, o que o próprio admin fez — e reverte uma alteração ou uma exclusão.

Duas ideias sustentam o módulo:

1. **O log guarda estado, não só o nome do evento.** Cada linha carrega `before` e `after` com os campos que a ação tocou. É isso que torna "reverter" possível sem uma função de undo escrita à mão para cada action: desfazer uma alteração é regravar `before` na linha que `targetId` aponta.
2. **Auditar nunca derruba a ação auditada.** Toda escrita é best-effort e engolida em `try/catch` (mesma regra de `modules/auth/attempts.ts`). Um índice quebrado no log não pode impedir um cliente de salvar a persona do agente.

## Arquivos

- `events.ts` — catálogo de eventos (`AUDIT_EVENTS`): a chave `dominio.acao`, o rótulo em português, o `kind` e se é revertível. Fonte única: a tela não escreve texto de evento à mão, e `revertAuditLog` consulta daqui se o evento aceita undo. Os eventos `crm.*` e `handoff.*` (grupo "CRM e transbordo") são gravados por `crm/trail.ts`, direto pelo Prisma e com ator explícito (`OWNER`, `GROUP`, `PHONE` ou `SYSTEM`), porque nascem também no webhook e no worker; ver `docs/painel/crm/domain.md#trilha-do-crm-e-do-transbordo`.
- `log.ts` — escrita. `recordAudit()` (evento avulso) e `recordChange()` (calcula o diff entre dois objetos e só grava se algo mudou). Resolve ator, tenant e IP sozinho a partir da sessão/headers.
- `diff.ts` — `diffFields(before, after)`: reduz dois objetos aos campos que realmente mudaram. Comparação por valor (datas por timestamp, JSON por conteúdo), não por referência.
- `query.ts` — leitura para o painel: `listAuditLogs(filters)` com paginação por cursor, `getAuditLog(id)` e `auditFilterOptions()`.
- `revert.ts` — `revertAuditLog(logId, actor)`: desfaz uma alteração (regrava `before`) ou uma exclusão (recria a linha com o **mesmo id**). Whitelist de modelos e campos.
- `redact.ts` — tira do snapshot o que não pode ser guardado em claro (`passwordHash`, tokens, credenciais cifradas) antes de qualquer gravação.

## Contratos expostos

```ts
recordAudit({ event, targetType?, targetId?, targetLabel?, before?, after?, meta? }): Promise<void>
recordChange({ event, target, before, after, meta? }): Promise<void>   // no-op se nada mudou

listAuditLogs(filters): Promise<{ rows: AuditRow[]; nextCursor: string | null }>
getAuditLog(id): Promise<AuditRow | null>

revertAuditLog(logId): Promise<{ ok: true; info: string } | { ok: false; error: string }>
```

## Reverter: o que é e o que não é

**Alteração** (`kind: "update"`) — regrava em `targetType`/`targetId` os campos de `before`. Só campos escalares de uma whitelist por modelo (`REVERTIBLE_MODELS` em `revert.ts`): reverter é escrever no banco a partir de dados guardados, e sem whitelist um log adulterado escreveria qualquer coluna, incluindo `role` e `tenantId`.

**Exclusão** (`kind: "delete"`) — recria o registro com o mesmo id, a partir da linha inteira guardada em `before`. O id volta igual de propósito: o que apontava para ele (conversas de um agente, chunks de um documento) volta a apontar. O que a restauração **não** traz de volta são os filhos apagados em cascade e os efeitos externos — arquivo já removido da CDN, voz apagada na Fish Audio, sessão derrubada na Evolution. A tela diz isso antes de confirmar; o módulo não finge que reverte o que é irreversível.

Não é revertível, por natureza: login, acesso/personificação e **exclusão de conta** (`tenant.delete`). A exclusão de conta cascateia por dezenas de tabelas e solta recursos em três serviços externos — restaurar a partir de um JSON produziria uma conta parcial que parece inteira, o que é pior que não restaurar. Quem precisa disso usa o backup (`scripts/restore.ts`).

Cada reversão **gera uma linha nova** (`admin.revert`) e marca a original com `revertedAt`. A trilha nunca é editada para esconder o que aconteceu, e o mesmo log não é revertido duas vezes — o segundo undo regravaria um `before` que já não corresponde ao estado atual.

## Autorização

Escrita: qualquer caminho autenticado (o próprio cliente gera logs ao mexer na conta dele). Leitura e reversão: **só SUPERADMIN**, garantido em `(admin)/` por `requireSuperadmin` e de novo dentro de `revertAuditLog` — esconder o botão não é autorização.

## O que NÃO faz

- Não é backup. Guarda o diff de uma ação, não o banco.
- Não substitui `LoginAttempt`: tentativa de login continua lá (caminho anônimo, volume e retenção próprios); o log só registra o **sucesso**, para a linha do tempo do admin ficar completa.
- Não retém para sempre — ver `pruneAuditLogs()` em `query.ts`, chamado pelo daemon de manutenção.
- Não faz o bloqueio/rate-limit de nada; só registra.

## Aceite dos riscos de confirmações QR

`scheduling.qr_risk_accepted` (grupo integrações, update, não reversível) registra
a ativação após salvar configuração, com agente/tenant e texto, versão, nome,
usuário e data do aceite. A identidade vem da sessão. A prova durável está no
JSON `TenantAction.config.clinicorpQrRiskAcceptance`; log continua best-effort
por contrato. Salvar novamente sem novo aceite não cria outra assinatura.
