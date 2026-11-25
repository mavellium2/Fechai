# Bitrix24 — Ações

| Entrada | Comportamento |
|---|---|
| `saveBitrixAction` | Exige produto e conta ativa. Valida o webhook, opções e responsável, mantém o webhook atual quando o campo fica vazio e revalida `/integracoes`. |
| `manageBitrixAction` | Mesma guarda. Testa, pausa, retoma, desconecta, antecipa conferências ou trata um envio sem confirmação. |
| `resolveUncertainBitrix` | Usa claim e busca por origem. Ausência confirmada pela clínica e busca vazia autorizam nova tentativa após cinco minutos, com outra busca antes de criar. |
| `scanBitrixSync` | Captura e processa pela fila `bitrix-crm-sync` no worker existente. Preserva a referência externa ao repetir trabalho ou atualizar o payload. |

Trocar de portal exige desconectar primeiro. O destino novo recebe sua própria `connectionKey` e os envios antigos ficam vinculados ao destino original. [Ações do painel](../../../src/app/(dashboard)/integracoes/bitrix-actions.ts) · [Worker](../../../src/modules/bitrix/worker.ts)
