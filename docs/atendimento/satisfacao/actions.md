# Pesquisa de satisfação — Server Actions

As actions em `src/app/(dashboard)/relatorios/actions.ts` verificam acesso ao produto e usam o tenant da sessão.

| Função | Validação e efeito |
|---|---|
| `saveSurveySettingsAction(prev, formData)` | Valida com `surveySettingsFormSchema`; grava espera, faixa, fuso e textos e registra auditoria. |
| `sendSurveyTestAction(prev, formData)` | Envia pela conversa real do número nas últimas 24h. Mantém bloqueio e opt-out e registra o teste. |
| `setSurveyTopicAction(surveyId, topic)` | Aceita uma categoria válida ou string vazia. Grava revisão humana da análise do comentário. |
| `markSurveyReviewedAction(surveyId)` | Grava responsável e data da revisão, retirando o aviso do início. |

As quatro retornam resultado estruturado com `ok` e feedback. O envio normal roda em `scanSatisfactionSurveys` e a captura da resposta em `handleSurveyReply`.

[Actions de Relatórios](../../../src/app/(dashboard)/relatorios/actions.ts) · [Captura](../../../src/modules/satisfaction/capture.ts)
