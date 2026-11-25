# Conversas — Histórico

### 2026-11-25 — Responsável, transferência e aviso no grupo

- **Arquivos** `actions.ts`, `ConversationThread.tsx`, `ConversationTransfer.tsx`, `page.tsx`, `crm/assignments.ts`, `crm/handoff-panel.ts`, `agent-engine/conversation.ts`.
- **Razão** O CRM-07 pede assumir, transferir e devolver também em Conversas, com o grupo sabendo de cada passo.
- **Impacto** Assumir define a responsável com ou sem CRM, responder pelo painel assume quando ninguém estava com a conversa, a faixa do topo mostra quem atende e permite transferir, e Resolver e Reativar agente avisam o grupo quando encerram um atendimento em curso.

### 2026-11-23 — Documentação por funcionalidade

- **Arquivos** Esta pasta.
- **Razão** Facilitar a consulta às ações da caixa de entrada.
- **Impacto** Lista, histórico, envio humano e contato ganham um ponto de entrada comum.

### 2026-10-27 — Conversas v1

- **Arquivos** `ConversationsWorkspace`, `ConversationThread` e `ContactPanel`.
- **Impacto** Layout contínuo com lista, histórico e contato, filtros na URL e busca local. [Registro da versão](../../../src/app/(dashboard)/conversas/README.md)
