# CRM nativo

O CRM organiza os leads em um quadro Kanban com colunas por etapa, totais e filtros compartilháveis. A ficha reúne dados declarados, origem, responsável, conversa, etiquetas, tarefas e linha do tempo. O superadmin libera o acesso por conta.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/crm`, configuração em `/crm/etapas` e ativação em `/admin/contas` |
| Acesso | Conta ativa com acesso ao produto, `Tenant.crmEnabled` ligado e permissão `crm:ver` ([`src/lib/permissions.ts`](../../../src/lib/permissions.ts)), conferida no servidor. |
| Código | [Módulo CRM](../../../src/modules/crm/README.md), [página do CRM](../../../src/app/\(dashboard\)/crm/page.tsx), [controle de acesso no admin](../../../src/app/\(admin\)/admin/contas/CrmAccess.tsx) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- A etapa comercial usa `Lead.stageId`. `Lead.status` continua servindo aos fluxos operacionais.
- A ativação provisiona as etapas e classifica os leads existentes antes de publicar a flag. Leads ou conversas de teste são excluídos.
- A configuração permite renomear e ordenar as etapas ativas. Etapas de sistema mantêm sua identidade semântica. Etapas personalizadas podem ser arquivadas com transferência dos leads para outra etapa ativa.
- O quadro permite mover leads por arraste ou pelo botão Mover. A etapa Perdido exige motivo do catálogo da conta e justificativa.
- O responsável do card e do filtro é o da conversa (`Conversation.assignedUserId`). "Humano não identificado" é o lead em Em atendimento humano sem pessoa atribuída, e não se soma a "Sem responsável".
- O selo de espera em Aguardando humano é calculado na leitura ([`sla.ts`](../../../src/modules/crm/sla.ts)) com os prazos da conta. Quem avisa é o worker ([Prazo do transbordo](domain.md#prazo-do-transbordo)): um alerta por limite, marcado antes do envio.
- Toda action e rota nova do CRM chama `requireCrmSession()`. O teste `tests/crm-permissao.test.ts` falha se a guarda faltar.
- Quem é da equipe no grupo de transbordo sai de `resolveGroupMember` ([WhatsApp da equipe](domain.md#whatsapp-da-equipe)). Número não confirmado nunca identifica ninguém.
- Cada transbordo é um `HandoffNotice` com o id da mensagem do grupo ([Aviso de transbordo](domain.md#aviso-de-transbordo)). Caminho novo que tire a conversa da espera precisa chamar `closeHandoffNotices`.
- A resposta da ficha usa a última entrada comprovada do contato e o mesmo número. Primeiro contato e retomada fora da janela da Meta passam por modelos aprovados em Disparos.
- A ficha usa a conversa que já existe no Fechai e mantém as etiquetas e tarefas no escopo da conta. O lembrete de prazo aparece no quadro.

## Referências

- [Contrato técnico e validação](../../../src/modules/crm/README.md)
- [Plano de implementação](../../plans/2026-11-23-crm-fechai.md)
- [Gestão de contas](../../administracao/contas/_index.md)
- [Contatos](../../atendimento/contatos/_index.md)
