# Scheduling — escrita

- saveScheduleConfigAction(prev,FormData): requireAgent → JSON/Zod → categorias → save/revalida. Ativar QR exige checkbox, versão atual e nome; sessão/data/texto do servidor, prova junto da flag, audit scheduling.qr_risk_accepted não reversível. Desativar preserva prova; reativar pede outra.
- saveScheduleConfig(tenantId,agentId,config): upsert TenantAction; criar não liga ação.
- createManualAppointment: sessão/conflito/reserva/espelhos.
- cancelAppointment: local/espelhos mesmo desabilitados; notas preservadas.
- rescheduleAppointment: troca horário/espelhos; mantém paciente/tipo.
- appointmentConfirmationAction: sessão/produto/conta, consulta fresca; enviar ou registrar manual na mesma intenção.
- testConfirmationMessage: prepareConfirmationTest, agente próprio/ativo, texto salvo no sandbox; sem envio.
- claimReminder/finishReminder: posse condicional antes do POST; unknown não repete.
- connectIcloudAction(prev,FormData): Zod → flag → criptografia → verifyIcloudCredentials → saveIcloudCredentials (um calendário = escolhido sozinho) → audit.
- saveIcloudSettingsAction: URL do calendário conferida na lista do iCloud; trocar de calendário chama moveIcloudEvents (apaga futuros do antigo, varredura reenvia).
- setIcloudToggle(field: syncEnabled|checkAvailability, enabled); testIcloudConnectionAction; disconnectIcloudAction (audit). Credencial só por getIntegration/saveIcloudCredentials.

UI ScheduleSettings: useActionState/toast; ClinicorpQrTermsDialog sibling do
formulário, feedback inline; checkbox/nome obrigatórios, só liga após sucesso.
Cancelar/Esc/fechar não ativa; reabrir zera aceite. Falha mantém modal.
