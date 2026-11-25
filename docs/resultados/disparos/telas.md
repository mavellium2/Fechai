# Disparos — Telas

| Rota | Comportamento |
| --- | --- |
| `/disparos` | Lista com busca, situação, indicadores, rascunhos e ação principal. Atualiza envio em andamento enquanto a aba está visível. |
| `/disparos/novo` | Assistente de mensagem, destinatários, revisão/teste e horário. Continuação de rascunho por `?rascunho=id`. |
| `/disparos/[id]` | Resultado por contato, filtros, conversa quando existente, exportação, pausa, retomada, cancelamento e revisão de falhas elegíveis. |
| `/disparos/modelos` | Biblioteca de modelos e status de aprovação. `/disparos/modelos/novo` envia um modelo novo para aprovação da Meta. |
| `/relatorios?visao=campanhas&secao=disparos` | Consolida campanhas confirmadas no período e resultados por etapa. |

Os destinatários podem vir dos contatos da conta, de uma lista digitada/colada ou de Excel/JSON. A revisão mostra variáveis resolvidas, tratamento de ausência de nome, contatos recentes, consentimento e faixa diária.

[Código das telas](../../../src/app/(dashboard)/disparos)
