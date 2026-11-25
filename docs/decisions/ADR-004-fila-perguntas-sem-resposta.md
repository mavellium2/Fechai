# ADR-004: fila de perguntas sem resposta (P-87)

**Data:** 2026-09-28 · **Status:** aceito

## Contexto

O agente recebia perguntas que a base não cobria. O evento `unanswered` já
existia, mas só contava no ROI mensal: a pergunta não chegava a ninguém, e
nada impedia o modelo de completar com um palpite plausível (preço médio de
mercado, convênio "comum"). O briefing pedia detectar, não inventar, levar a
pergunta a uma fila com aviso, ensinar a base pela aprovação e medir.
Ficou em aberto quem responde a fila: a clínica, a Mavellium ou as duas —
com a exigência de mascarar dados do paciente para quem não é da clínica.

## Decisão

1. **Detecção explícita pela tool, regra no prompt, sem verificador.** A fila
   só recebe o que o agente registra com `report_unanswered({ question })`
   (ou `handoff_human` com `unanswered`). A regra "nunca invente" vai no prompt
   de todo turno, com aviso extra quando a busca da base volta fraca, e é
   repetida no resultado da tool. Não há segundo LLM conferindo a resposta.
2. **Agrupamento conservador.** Assunto aberto do mesmo agente, por texto
   normalizado e depois por vetor com distância de cosseno ≤ 0,15. Contagem é
   de conversas distintas.
3. **Aprovar grava um documento na base do agente**, reescrito nas edições,
   em vez de uma segunda base ou de respostas prontas fora do RAG.
4. **Quem responde é configuração por conta** (`clinic` | `mavellium` |
   `both`), definida só pelo superadmin, padrão `clinic`. A Mavellium sempre
   vê a fila mascarada (inclusive personificando). Avisos não levam dado de
   paciente.
5. **Retomar o contato é explícito, uma vez por contato, sem nova
   tentativa**, dentro da janela do canal e respeitando bloqueio, "pare" e
   resposta humana já dada. Não pausa o agente.
6. **Avisos no worker**, nunca no turno: aviso por pergunta nova (em lote por
   varredura) e resumo diário, com claims no banco.
7. **Configuração da conta, não ação do catálogo** (`KnowledgeGapSettings`).
   O transbordo (`keep` | `handoff`) e os avisos não ocupam vaga de
   habilidade do plano; `keep` preserva o comportamento anterior.

## Alternativas descartadas

- **Inferir desconhecimento do texto da resposta** ("não sei", "vou verificar")
  ou **um verificador por LLM**: custo em toda mensagem, contando na cota, e
  falso positivo virando fila. O relatório já adotava eventos explícitos.
- **Resposta fixa forçada (`replyOverride`) ao registrar**: garantiria o texto,
  mas apagaria a parte da mensagem que o agente sabe responder.
- **Juntar por vetor com limite frouxo**: juntar "implante" com "clareamento"
  faz uma pergunta sumir da fila ao responder a outra; separar paráfrases só
  custa um card a mais.
- **Decidir quem responde no código** (sempre clínica ou sempre Mavellium): o
  briefing deixou em aberto por cliente; configuração resolve sem bloquear.
- **Retomar automaticamente ao aprovar**: mandar mensagem a contato real é
  decisão de quem aprova, e o texto da base nem sempre serve de mensagem.
- **Aviso no celular de um atendente**: mensagem a número que nunca falou com
  a clínica leva o número ao bloqueio; o grupo interno já existe na
  transferência.

## Consequências

- A garantia de "nunca inventar" é de prompt. O trecho da conversa na fila
  mostra à equipe se o agente segurou a regra.
- Três tabelas novas (`db push` + `generate` na web e no worker) e uma fila
  nova no worker.
- Contas existentes passam a receber e-mail a cada pergunta nova (avisos
  nascem ligados) — desligável em `/perguntas`.
- O ROI mensal ganha "tempo médio para a equipe responder"; relatórios
  fechados antes continuam legíveis ("Sem registro").
- Paráfrases podem ficar separadas; não há juntar/separar à mão.
- Retomar pela Meta depois de 24h exigiria template — fora do escopo.

Detalhes e operação: [P-87](../atendimento/perguntas-sem-resposta/P-87-perguntas-sem-resposta.md) e
[knowledge-gaps/README.md](../../src/modules/knowledge-gaps/README.md).
