# Qualidade dos leads — Consultas

| Função | Uso |
| --- | --- |
| `getServiceArea` | Lê a área da conta. Ausência ou falha retorna `null`. |
| `loadLeadQuality` | Lê a qualidade dos contatos reais que escreveram e foram respondidos em `[from, to)`. Aceita premissas e escopo de agentes. |
| `loadLeadQualityDetail` | Devolve o agregado e evidências por lead para o mensal, com ids, datas, cidade e classificações. |
| `loadHistoricalCities` | Reconhece declarações literais até o fim da janela quando falta registro estruturado. Usa o cadastro de municípios do IBGE. |

A leitura reaproveita `contactActivity` para excluir envios automáticos da base de respostas. “Agendou” exige avaliação do agente criada no intervalo e ainda válida, dentro das premissas da revisão. A cidade histórica é recuperada em leitura e a evidência guarda id e data, com o conteúdo da mensagem restrito ao servidor.

[Implementação](../../../src/modules/lead-insights/queries.ts) · [Leitura de cidades](../../../src/modules/lead-insights/historical-city-store.ts)
