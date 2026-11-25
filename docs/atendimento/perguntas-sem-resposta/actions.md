# Perguntas sem resposta — Server Actions

A tela da conta verifica acesso ao produto e `responders` a cada mutação da fila. O admin valida a sessão administrativa e a permissão da Mavellium para a conta selecionada.

| Função da conta | Equivalente admin | Efeito |
|---|---|---|
| `saveGapDraftAction(gapId, draft)` | `adminSaveGapDraft` | Guarda rascunho da resposta. |
| `approveGapAction(gapId, answer, resumeMessage)` | `adminApproveGap` | Aprova resposta e publica na base. Se há mensagem de retomada, processa as ocorrências elegíveis. |
| `resumeGapAction(gapId, message)` | `adminResumeGap` | Tenta retomar os contatos elegíveis de uma pergunta respondida. |
| `dismissGapAction(gapId)`, `reopenGapAction(gapId)` | `adminDismissGap`, `adminReopenGap` | Mudam a situação da fila. |
| `saveGapSettingsAction(prev, formData)` | — | Valida e grava a regra de atendimento e canais de aviso. |
| — | `adminSetGapResponders(tenantId, value)` | Superadmin seleciona clínica, Mavellium ou ambas. |

As variantes administrativas recebem `tenantId` antes dos parâmetros da pergunta.

[Actions da conta](../../../src/app/(dashboard)/perguntas/actions.ts) · [Actions do admin](../../../src/app/(admin)/admin/perguntas/actions.ts)
