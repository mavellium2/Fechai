# Relatório mensal — Ações

| Ação administrativa | Comportamento |
| --- | --- |
| `previewMonthlyRoiImport` | Prévia da importação de premissas e dados da conta para conferência no formulário. |
| `saveMonthlyRoi` | Valida e grava revisão em rascunho. O decisor deve ser dono ou sócio presente em `Tenant.ownerNames` e distinto do contato operacional. |
| `generateMonthlyRoiAnalysis` e `assistMonthlyRoi` | Geram rascunho de texto ou consultam evidências. A lista proposta para a recepção é montada pelo servidor e depende do clique em “Gerar lista”. |
| `saveMonthlyPendency` e `recordMonthlyPendencyRequest` | Registram responsável, resposta e solicitação. Alterações de presença e premissas têm fluxo próprio. |
| `finalizeMonthlyRoi` | Valida dados e revisão, confere a impressão digital da lista de limitações aceita e persiste uma nova versão. |
| `reopenMonthlyRoi` e `recordMonthlyDelivery` | Reabrem revisão ou registram envio/reunião, preservando a versão entregue no histórico. |

O fechamento exige mês encerrado, decisor válido, ajustes registrados, plano seguinte e as ações anteriores com status e evidência do resultado. Limitações podem ser aceitas com cobertura parcial se a lista permanecer a mesma até o clique. Concorrência de edição é verificada no servidor.

[Ações de revisão e fechamento](../../../src/app/(admin)/admin/relatorios/[tenantId]/actions.ts) · [Guardas de fechamento](../../../src/modules/reports/monthly-close-check.ts)
