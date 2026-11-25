# Agentes — Histórico

### 2026-11-25 — Comandos no grupo de transbordo

- **Arquivos** `handoff.ts` (`HANDOFF_GROUP_COMMANDS = true`), `HandoffSettings.tsx`, `crm/handoff-group.ts`.
- **Razão** O CRM-08 passa a ler o grupo, então o aviso pode prometer os comandos.
- **Impacto** O aviso termina com "Responda *assumo* ou reaja 👍 para ficar com este lead. *#ia* devolve para a IA.", e a tela de transferência mostra essa linha no exemplo e explica os comandos. O agente nunca responde no grupo.

### 2026-11-24 — Aviso de transbordo v2

- **Arquivos** `handoff.ts`, `handoff-notice.ts`, `handoff-form.ts`, `HandoffSettings.tsx`.
- **Razão** O CRM-06 pede o card em Aguardando humano, o link do card no aviso, o vínculo entre a mensagem do grupo e a conversa e a escolha de pausar a IA.
- **Impacto** O aviso ganha origem, motivo e link do card; cada espera vira um `HandoffNotice` com o `messageId`; transbordo repetido com espera aberta não avisa de novo; a pausa é opcional e desligada por padrão.

### 2026-11-23 — Documentação por funcionalidade

- **Arquivos** Esta pasta.
- **Razão** Reunir a entrada de Agentes, suas habilidades e o fluxo de teste.
- **Impacto** A documentação técnica do motor e o mapa da interface continuam disponíveis pelos links.

### 2026-10-27 — Agentes v7

- **Arquivos** `AgentDirectory`, `AgentWizard` e sandbox.
- **Impacto** Cards no diretório, editor com resumo e teste lateral com inspeção e comparação. [Registro da versão](../../../src/app/(dashboard)/agentes/README.md)
