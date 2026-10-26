# .claude

## Módulos Documentados

Leia o `_index.md` antes do código-fonte.

- [painel](context/painel/_index.md) — navegação tenant/admin, temas e switch, tipografia e interface de Agentes v5

- [bitrix](context/bitrix/_index.md) — integração por conta: contatos, leads/negócios, reuniões e fila (`src/modules/bitrix/`)

- [toast](context/toast/_index.md) — notificações de salvamento (`src/components/ui/toast/`)
- [scheduling](context/scheduling/_index.md) — agenda, integrações (Google, Clinicorp, Calendário da Apple/iCloud por CalDAV) e público dinâmico dos lembretes
- [agent-engine](context/agent-engine/_index.md) — turno da IA, montagem do prompt, tools, datas relativas (`src/modules/agent-engine/`)
- [lead-insights](context/lead-insights/_index.md) — qualidade dos leads do tráfego: cidade, raio, dúvidas, motivos de perda (`src/modules/lead-insights/`)
- [satisfaction](context/satisfaction/_index.md) — pesquisa de satisfação pós-conversa: nota 1–5, comentário, painel, alerta de notas baixas e bloco no relatório mensal (`src/modules/satisfaction/`)
- [reports](context/reports/_index.md) — relatório mensal de ROI (P-79): assistente de fechamento em 5 etapas, fechamento com cobertura parcial, análise por IA, PDF, central de pendências e origem + selo de qualidade de cada número (`src/modules/reports/`)
