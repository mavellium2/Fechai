# Relatórios Operacional e Financeiro — Domínio

## Operacional

- `ReportRange` representa a janela atual, a anterior e a granularidade da série. Uma competência completa compara com o mês civil anterior. Intervalos parciais usam uma janela anterior da mesma duração.
- `PeriodReport` agrega mensagens, entrada e resposta, agendamentos, contexto do contato e reconciliação dos leads. Leads quentes e a fila “Precisam de você” mostram o estado atual.
- `contactActivity` conta contatos que escreveram na janela e receberam resposta posterior da IA ou da equipe dentro dela. Campanha, lembrete e follow-up enviados automaticamente ficam fora das respostas.
- `contexts.autonomy` divide só IA por só IA + IA e humano + só humano, dentro de `PATIENT_CONTEXTS`. Transferência tira a conversa de só IA mesmo se a equipe ainda não respondeu.
- `leadReconciliation` fecha tanto os leads criados na janela (atendidos, sem resposta da equipe, sem resposta do contato e sem mensagens) quanto os contatos atendidos (novos e antigos).
- Agendamentos gerais usam `Appointment.createdAt`, com exclusão de cancelados e testes. O recorte de avaliações pelo agente aplica as premissas do mês. `attendanceOf` preserva a distinção entre compareceu, faltou e presença desconhecida.

## Financeiro

- `TenantLeadValue` e `TenantAttendanceCost` guardam premissas com vigência. A primeira estima valor por lead. A segunda usa minutos por contato e custo por hora para estimar economia da triagem.
- `FinancialSummary` estima retorno e custo por lead. O valor investido usa o plano atual ou `Tenant.priceCentsOverride`. Ausência de uma premissa deixa a métrica derivada indisponível.

[Contratos do módulo](../../../src/modules/reports/README.md)
