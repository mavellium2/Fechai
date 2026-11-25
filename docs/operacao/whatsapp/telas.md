# WhatsApp — Telas

| Entrada | Comportamento |
|---|---|
| `/integracoes?aba=canais` | `WhatsappConnect` gerencia QR e status. `MetaWhatsappConnect` e `MetaEmbeddedSignup` gerenciam a API oficial quando liberada. Cada conexão tem seu próprio desligamento. |
| Controles da conta | `AttendanceControls` e `WhatsappBlocklist` gerenciam atendimento, grupos e bloqueios. A Meta oferece a opção de manter o número só para Disparos. |
| QR desativado | A conta com conexão anterior recebe o aviso de desativação, sem QR nem botão. Conta que nunca conectou fica sem o card correspondente. |
| Recuperação do histórico | `WhatsappHistoryRecovery` aparece na conta ativa personificada pelo superadmin quando há QR liberado e instância. |
| `/admin/contas` | O superadmin libera cada provedor para a conta. |

Links antigos de `/whatsapp` levam às Integrações. [Página de integrações](../../../src/app/(dashboard)/integracoes/page.tsx) · [Cadastro da Meta](META_COEXISTENCIA.md)
