# Perguntas sem resposta — Queries

| Função | Escopo, retorno e ordenação |
|---|---|
| `listGaps(tenantId, status, { masked, take? })` | Até 40 assuntos por padrão. Abertos descem por quantidade de contatos e recência; respondidos e descartados por atualização. Exibe até oito ocorrências e o trecho da conversa mais recente. |
| `countGaps(tenantId)` | Contagem por situação para as abas. |
| `gapStats(tenantId, timezone, now?)` | Abertas, aprovadas e demora média de aprovação em 30 dias. A tendência de seis meses usa eventos `unanswered` de contatos reais. |
| `getGapSettings(tenantId)` | Configuração da conta com defaults quando não há registro. |

`masked: true` aplica a máscara antes da projeção da fila para admin e personificação. O trecho e a pergunta são processados com os nomes e telefones de todos os contatos do assunto.

[Leituras da fila](../../../src/modules/knowledge-gaps/queue.ts) · [Configuração](../../../src/modules/knowledge-gaps/register.ts)
