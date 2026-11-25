# Relatório mensal — Domínio

## Modelos

- `MonthlyRoiReport` guarda a revisão por conta e competência, premissas, correções, dados editoriais, status e snapshot publicado.
- `MonthlyRoiReportVersion` guarda cada fechamento com snapshot e hash. `MonthlyRoiPendency` guarda responsável, pedido e resposta de um tópico de conferência.
- `MonthlyReportData` é o contrato v2. As métricas carregam valor, status e fonte. Ausência de evidência pode deixar valor nulo ou retirar a linha quando indisponível.

## Métricas

- Atendimento conta um contato que escreveu e recebeu resposta da IA ou da equipe no mês. A divisão por expediente usa a primeira chegada e o horário cadastrado, com feriados prevalecendo sobre a grade semanal.
- A coorte inclui avaliações do agente criadas no mês. Consulta passada sem marcação de presença fica não verificada. Avaliações criadas antes do mês e realizadas nele aparecem à parte.
- A recepção mede, em tempo corrido, da primeira transferência à primeira resposta humana até o fim do mês. A disponibilidade vem de quedas confirmadas em `WhatsappIncident` e do início da medição.
- Duração de áudio vem da duração medida da mensagem. O tempo economizado em texto deriva de `secondsPerMessage` ou da premissa legada por conversa.
- Qualidade dos leads, anúncios e satisfação aparecem quando a competência tem base para cada bloco. A estimativa financeira usa as premissas da revisão e restringe a receita aos contatos que chegaram fora do expediente da recepção.

[Contrato e origem das métricas](../../../src/modules/reports/monthly-data.ts) · [Regras do relatório](../../../src/app/(dashboard)/relatorios/README.md#relatrio-mensal-v2-visomensal-rtulo-relatrio-mensal)
