# Campanhas — Telas

| Tela | Comportamento |
| --- | --- |
| `/campanhas` | Painel e lista, campanhas em vigor, filtro de situação e recorte do período. |
| `/campanhas/[id]` | Resultados, Leads, Configuração e Histórico. Rascunho abre na configuração. |
| Configuração | O básico, quem atende, agenda, de onde vêm os leads, arquivos, revisar e ativar. Os endereços antigos são interpretados por `labels.ts`. |
| Leads | Vincula manualmente e mostra etapa. O card do contato em `/conversas` também permite vínculo. |
| `/relatorios?visao=campanhas&secao=anuncios` | Consolida leads por anúncio, com agendamentos e comparecimento. O painel semanal inclui configuração, prévia e importação de histórico. |
| `/relatorios?visao=campanhas&secao=disparos` | Consolida envios confirmados, entregas e resultados para contas ativas com Meta liberada. |

O guia **Como funciona** acompanha o roteiro. O atalho para disparo preenche o vínculo com `/disparos/novo?campanha=<id>`.

[Código das telas](../../../src/app/(dashboard)/campanhas) · [Relatório semanal por anúncio](relatorio-semanal.md)
