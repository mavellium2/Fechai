# campaign-override — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-11-13] — Documentação inicial + regra provisória (URG-01/URG-04, PR-1)

**Arquivos:** `schema.prisma` (`CampaignOverride`), `campaign-override/*`, `scripts/campanha-*.ts`, `audit/events.ts`, `tests/campanha-implantes-*`

**Razão:** economizar tokens em futuras sessões.

**Impacto:** só scripts; agente, agenda e lembretes entram no PR-2. `db push` + `generate` em web e worker.
