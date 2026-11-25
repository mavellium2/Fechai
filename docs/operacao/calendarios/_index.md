# Integrações de calendário

Conectam a agenda do Fechai ao Google Agenda, ao Clinicorp e ao Calendário da Apple, com opções de envio e leitura por conta.

| Aspecto | Onde fica |
|---|---|
| Menu | Integrações → Calendários (`/integracoes?aba=calendarios`) |
| Modelos | `CalendarFeatures`, `CalendarIntegration`, `ClinicorpIntegration`, `IcloudCalendarIntegration` |
| Lógica | [Módulo de agenda](../../../src/modules/scheduling/README.md) |
| Compromissos e lembretes | [Agenda](../agenda/_index.md) |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Queries](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

1. Habilitar o calendário abre o formulário. Desabilitar pausa a sincronização e preserva a credencial. Desconectar remove a conexão.
2. O Google recebe eventos. Clinicorp e iCloud também alimentam a disponibilidade e mostram itens externos na agenda.
3. As conexões Clinicorp e iCloud usam credenciais cifradas. A leitura para exibir estado retorna somente os dados necessários à tela.

[Diagnóstico histórico do Clinicorp](DIAGNOSTICO-CLINICORP.md)
