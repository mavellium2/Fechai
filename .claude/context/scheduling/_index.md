# Scheduling

Agenda, espelhos Google/Clinicorp/Calendário da Apple (iCloud), confirmações e lembretes por tipo.

| Área | Fonte |
| --- | --- |
| Domínio | config.ts, qr-risk-terms.ts |
| Escrita/leitura | repository.ts, clinicorp.ts; agentes/actions.ts |
| Envio | workers/follow-up-worker/{reminders,clinicorp-reminders}.ts |

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) ·
[Padrões](patterns.md) · [Histórico](changelog.md).

Antes de usar: README; tenant em consultas; time.ts; falha do espelho não apaga
reserva. Público vale em ambas as filas/overrides; categoria ausente não envia.
QR exige categorias por ID e aceite de riscos válido (modal + nome + checkbox).
Claim/recibos em reminder-dispatch.ts; incerto nunca repete. Sandbox não entrega.
iCloud: credencial só por getIntegration/saveIcloudCredentials; leitura com falha =
null (não oferece horário, nunca agenda vazia); 412 = já enviado; eventos do iPhone
só leitura. Guia: src/modules/scheduling/README.md, "Calendário da Apple (iCloud)".
