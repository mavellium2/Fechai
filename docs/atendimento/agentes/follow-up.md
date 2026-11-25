# Agentes — Follow-up

A habilidade `follow_up` envia mensagens de retomada por WhatsApp em esteiras configuráveis de silêncio (`noReply`) e recusa de agendamento (`declined`). As etapas guardam a antecedência relativa em `delayMinutes` e a mensagem de cada envio. `parseFollowUpConfig` ainda aceita o formato antigo com `delayHours`.

| Responsabilidade | Arquivo |
|---|---|
| Editar esteiras e faixa de envio | [FollowUpSettings.tsx](../../../src/app/(dashboard)/agentes/FollowUpSettings.tsx) |
| Ler, validar e persistir configuração | [config.ts](../../../src/modules/follow-up/config.ts) |
| Avaliar e enviar no worker | [scan.ts](../../../workers/follow-up-worker/scan.ts) e [guia do worker](../../../workers/follow-up-worker/README.md#follow-up-em-esteira-scants) |

O worker verifica se a conversa continua elegível. Agente desligado, conversa pausada ou transferida, bloqueio, opt-out, consulta marcada e pesquisa de satisfação já enviada impedem a retomada. A primeira espera começa na última fala do agente, as seguintes partem do último envio. Uma etapa atrasada em mais de 26h encerra a esteira até o contato voltar a escrever. O canal vem da conversa. Com o número indisponível, a etapa espera. [Regras de canal](../../../src/modules/whatsapp/README.md) · [Pesquisa de satisfação](../satisfacao/_index.md)

Etapas personalizadas por IA usam a cota quando a personalização é gerada. Se IA ou cota estiver indisponível, segue o texto fixo da etapa. [Composição da mensagem](../../../src/modules/follow-up/compose.ts)

Lembretes de consulta têm configuração própria em `schedule_meeting`. [Agendamento e lembretes](../../../src/modules/scheduling/README.md)
