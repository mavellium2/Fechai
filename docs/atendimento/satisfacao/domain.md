# Pesquisa de satisfação — Domínio

| Modelo | Campos e relações relevantes |
|---|---|
| `SatisfactionSurveySettings` | Chave `tenantId`, ativação, espera em minutos, faixa de horas local, fuso e quatro textos. |
| `SatisfactionSurvey` | Conta, conversa, agente, canal, estado, `isTest`, data de envio e da nota, nota, comentário, classificação e revisão. |

1. Após o silêncio configurado, o worker verifica a faixa local e o prazo de 24h desde a última mensagem recebida, com margem de 60 min. A avaliação exige interação real com o agente e exclui pausas, transbordos, opt-out e outros impedimentos.
2. A Meta apresenta uma lista interativa. O QR usa texto numerado. Em ambos, a nota 1–3 escolhe o texto para nota baixa; 4–5 escolhe o outro. O primeiro comentário encerra a pesquisa.
3. Resposta alheia à nota segue para o atendimento e fecha a pesquisa pendente como `no_reply`. A captura roda antes do turno, sem criar uma `Message` ou mover `lastInboundAt`.
4. A linha `sending` é gravada antes do POST. Resultado incerto vira `unknown` e fica sem nova tentativa. Contato que recebeu pesquisa real entra em intervalo de 30 dias e encerra sua esteira de follow-up.
5. Classificação em segundo plano usa categorias fechadas. Ajuste humano tem prioridade. O relatório mensal guarda agregados, com média a partir de cinco respostas e sem texto do comentário.

[Schema](../../../prisma/schema.prisma) · [Regras de elegibilidade e captura](../../../src/modules/satisfaction/README.md)
