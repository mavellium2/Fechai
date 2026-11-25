# SDD — Relatório Mensal do Fechai (v2)

## Progresso da implementação — 01/10/2026

Especificação recuperada da conversa local do Claude sobre relatórios. O texto
original segue abaixo; o estado atual é registrado aqui para a continuação.

- Fases 0–5: implementadas no PR #4 (`b7f6a7f`).
- Fase 6: motor de disponibilidade medida, tempo devolvido e ações anteriores
  em `main`; documento v2 ligado às quedas reais, ações anteriores e fatos do
  caso pelo PR #5 (`680970f`). Usa `WhatsappIncident` do monitor existente,
  conforme as regras atuais, em lugar de um cadastro manual de `AgentIncident`.
- Continuação: conferência dos registros v2 no cliente e no admin, com
  `MonthlyReportEvidence` e `monthly-v2-evidence.ts`. Sem consulta adicional,
  sem recálculo do snapshot e sem registros no PDF.
- Continuação: feriados e dias sem recepção em `assumptions.humanClosedDates`,
  informados na etapa 2. Datas locais fecham a recepção o dia inteiro no fuso
  cadastrado e entram nas premissas do painel/PDF. Sem agenda automática de
  feriados, sem recorrência anual e sem importar bloqueios do agente.
- Validação com banco e sessão reais ainda precisa ser exercitada; testes de
  regras não substituem esse fluxo. A aplicação do schema em produção não foi
  verificada nesta continuação.
- Conferência desta continuação: lint, TypeScript e 1.408 testes passaram.
  Build Turbopack bloqueado pelo ambiente ao abrir porta; tentativa com
  Webpack esbarrou em `node:crypto` no bundle de agentes, pelo caminho
  `meta-config.ts` → `handoff.ts` → `ActionsToggles.tsx` → `AgentWizard.tsx`,
  que não foi alterado nesta entrega.

---

> **Para o Claude Code.** Este documento especifica as mudanças no Fechai para gerar o relatório mensal no formato aprovado em 30/09/2026. O modelo visual de referência é o artifact "Relatório Fechai de Exemplo" (versão 2). Os números fictícios dele estão na seção 11 e servem de fixture de teste.
>
> **Antes de escrever código, faça a Fase 0** (reconhecimento) e devolva o plano. Não invente nomes de tabela, campo ou função: confirme no código. Quando um dado exigido aqui não existir no banco, registre o problema na seção "Lacunas" do plano em vez de improvisar.

---

## 1. Contexto

Hoje existem duas superfícies:

- **`/relatorios`** (cliente): uma página com até 5 visões trocadas por `?visao=`. Calculada no servidor em `page.tsx`. Operacional e Financeiro vêm de `computePeriodReport` e `computeFinancialSummary` (`service.ts`). O ROI mensal vem de `monthly.ts`. Qualidade dos leads vem de `loadLeadQuality`.
- **`/admin/relatorios`** (superadmin): fechamento do ROI mensal por clínica, com o assistente de 5 etapas (`MonthlyRoiEditor.tsx`), as actions (`actions.ts`: salvar, fechar, reabrir, registrar entrega), a central de pendências e o painel "Perguntar à I.A".

**Regras que já valem e continuam valendo:**
- Toda consulta filtra por conta e ignora conversa de teste (`isTest: false`).
- Dinheiro em centavos, exibido com `formatBRL()`.
- Agrupamento por dia, mês e hora no fuso `America/Sao_Paulo`.
- O cliente vê o snapshot congelado no fechamento.
- Salvar, fechar, reabrir e entregar vão para o log de auditoria.

**Problemas do relatório de setembro (Instituto do Sorriso) que motivaram esta versão:**
- A página 1 abria com "ROI: Pendente".
- 117 contatos atendidos contra 277 leads, sem explicação.
- 0 qualificados com 9 agendados.
- 0 transbordos, mas 43 conversas tiveram resposta humana.
- Primeira resposta média de 6.494 s, misturando a IA com a equipe.
- Texto e cálculo divergentes.
- Coluna de agosto zerada.
- Decisor errado.

## 2. Decisões de produto (não reabrir)

| # | Decisão |
|---|---|
| D1 | O relatório mede o que o Fechai controla: atendimento, agendamento e comparecimento. **Métrica-âncora: avaliações agendadas e realizadas.** |
| D2 | **Todos os leads entram**, dentro e fora do expediente. O agente atende todos igual; o expediente é só uma quebra dentro de cada número. |
| D3 | **Tudo que puder ser medido aparece.** Um bloco só some quando não há dado nenhum. |
| D4 | O financeiro é **opcional**. O bloco "Retorno estimado" só aparece com ticket, conversão e custo da equipe confirmados. Sem eles, o bloco não é renderizado: nada de "Pendente", zero ou convite no PDF. |
| D5 | A regra conservadora (receita só de quem chegou com a recepção fechada) vale **só** no bloco de retorno estimado. |
| D6 | Do Clinicorp só se exige o **status de comparecimento**. Faturamento não. |
| D7 | O **decisor é o dono/sócio**, não a recepção. A recepção é contato operacional e recebe cópia. |
| D8 | Caso do mês mostra idade, duração dos áudios, dia da semana e período (manhã/tarde/noite). **Nunca** nome, telefone ou data exata. Pode ser um lead que não agendou. |
| D9 | A seção "O que não saiu como planejado" aparece sempre. Sem incidente comprovado, diz: "Nenhum incidente relevante identificado neste mês." A IA nunca inventa problema. |
| D10 | Arquitetura em três camadas: **o motor de dados calcula e valida → a IA só redige a partir de números validados → o PDF só apresenta o snapshot aprovado.** |

## 3. Não-objetivos

- Reativação da base (P-88), segmentação (P-85) e pesquisa de satisfação ficam fora. Só deixe o contrato de dados preparado para receber métricas novas.
- Integração com faturamento do Clinicorp.
- Mudar o visual das visões Operacional, Qualidade e Afiliados, além do necessário pela seção 8.4.

## 4. Arquitetura alvo

```
[Banco: conversas, mensagens, agendamentos, incidentes, premissas]
        │
        ▼
(1) Motor de métricas  ── monthlyMetrics(tenantId, mes) → MonthlyReportData
        │                    cada número com valor + status + fonte
        ▼
(2) Validador          ── validateReport(data) → Issue[] (bloqueante | aviso | pendência)
        │
        ▼
(3) Redação IA         ── recebe só MonthlyReportData validado + ids de evidência
        │                    devolve textos; não calcula número nenhum
        ▼
(4) Snapshot           ── fechar() congela data + textos + premissas + versão
        │
        ▼
(5) Renderização       ── a mesma árvore de componentes para painel e PDF;
                           o PDF é gerado no servidor a partir do snapshot
```

**Regra dura:** nenhum número pode ser calculado em componente React, no prompt da IA ou no gerador de PDF. Todos vêm de `MonthlyReportData`.

## 5. Contrato de dados

Crie (ou adapte, se já existir algo equivalente em `monthly.ts`) um tipo único. Os nomes abaixo são sugestão; mantenha a convenção do projeto.

```ts
type MetricStatus =
  | 'medido'          // calculado de registros do Fechai
  | 'confirmado'      // confirmado por fonte externa (ex.: Clinicorp)
  | 'estimado'        // depende de parâmetro/premissa
  | 'parcial'         // cobertura incompleta (ex.: só 4 de 277 leads com cidade)
  | 'nao_verificado'  // dado esperado, sem confirmação
  | 'indisponivel';   // não há fonte; o bloco/linha não renderiza

interface Metric<T = number> {
  value: T | null;
  status: MetricStatus;
  source: string;          // ex.: 'messages', 'appointments+clinicorp', 'premissa:ticket'
  evidenceIds?: string[];  // ids dos registros que compõem o número (rastreabilidade)
  note?: string;           // metodologia curta, ex.: '30 s por mensagem de texto'
}

type Split<T = number> = { expediente: Metric<T>; fora: Metric<T>; total: Metric<T> };

interface MonthlyReportData {
  meta: {
    tenantId: string; mes: string /* 'YYYY-MM' */; geradoEm: string;
    expediente: ExpedienteConfig; // cadastrado pela clínica
    decisor: { nome: string; papel: 'dono' | 'socio' } | null;
    contatoOperacional: { nome: string } | null;
    mesAnteriorComparavel: boolean;
  };
  atendimento: {
    contatos: Split;                    // D2: todos
    resolvidasSoAgente: Metric;
    transferidas: Metric;
    primeiraRespostaAgenteMedianaSeg: Metric;
    disponibilidadePct: Metric;
    incidentes: Incidente[];            // início, fim, contatos afetados
    recepcao: {
      transferidasRespondidas: Metric;
      primeiraRespostaHumanaMedianaSeg: Metric;
      esperaramMaisDe1h: Metric;
      semRespostaNoFimDoMes: Metric;
    };
    tempoDevolvido: {
      audios: { quantidade: Metric; totalSeg: Metric; maiorSeg: Metric; acimaDe2min: Metric };
      textoSeg: Metric;                 // status 'estimado'
      totalSeg: Metric;
    };
    porFaixaHoraria: { faixa: string; contatos: number }[];
  };
  agenda: {
    qualificados: Split;
    coorte: {                           // avaliações MARCADAS no mês
      compareceram: Split; faltaram: Split; aguardando: Split;
      naoVerificado: Split; total: Split;
    };
    taxaComparecimentoPct: Metric;      // compareceram / (compareceram + faltaram)
    deMesesAnterioresRealizadasNoMes: { compareceram: Metric; faltaram: Metric };
    porProcedimento: { procedimento: string; agendadas: number }[];
  };
  ajustes: {
    acoesMesAnterior: AcaoAvaliada[];   // seção 8.3
    perguntasSemResposta: { mes: Metric; mesAnterior: Metric };
    mudancasNoAgente: MudancaAgente[];  // registradas no admin, com data
    casoDoMes: CasoDoMes | null;        // D8
  };
  qualidade: {
    cidadeInformada: Metric; foraDaArea: Metric; foraDaAreaAgendaram: Metric;
    primeiraDuvida: { categoria: string; pct: number }[];
    motivoPrincipalNaoAgendou: { motivo: string; contatos: number }[];
    sugestoesTrafego: string[];
  };
  problemas: Problema[];                // derivados de dados; vazio = mensagem padrão (D9)
  proximoMes: AcaoPlanejada[];          // máx. 3
  retornoEstimado: RetornoEstimado | null; // null quando faltar premissa (D4)
  comparativo: Record<string, number> | null; // null se !mesAnteriorComparavel
}
```

## 6. Definições das métricas

Todas no fuso `America/Sao_Paulo`, por conta e com `isTest: false`. "Mês" = do dia 1 às 00:00 até o último dia às 23:59:59.

| Métrica | Definição | Status |
|---|---|---|
| **Contato atendido** | Contato único com ≥ 1 mensagem recebida do lead no mês **e** ≥ 1 resposta (IA ou humano). A unidade é o **contato**, não a conversa nem o lead criado. | medido |
| **Expediente × fora** | Classificar pelo horário da **primeira mensagem recebida do contato no mês**, comparado com o `ExpedienteConfig` da clínica (dia da semana + faixas; feriados, se houver cadastro). Nunca use faixa fixa. | medido |
| **Resolvidas só pelo agente** | Contatos sem nenhuma mensagem humana no mês. | medido |
| **Transferidas** | Contatos com ≥ 1 mensagem humana **ou** evento de transbordo no mês. **Invariante:** só agente + transferidas = contatos. | medido |
| **1ª resposta do agente** | Mediana, em segundos, entre a 1ª mensagem do contato no mês e a 1ª resposta da IA. Só mensagens da IA. | medido |
| **1ª resposta da recepção** | Mediana entre o transbordo (ou, sem evento, a última mensagem do lead antes da 1ª humana) e a 1ª mensagem humana. | medido |
| **Esperaram > 1h / sem resposta** | Sobre as transferidas, pelo mesmo intervalo acima. "Sem resposta" = transferida sem nenhuma mensagem humana até o fim do mês. | medido |
| **Disponibilidade** | `(horas do mês − horas de indisponibilidade) ÷ horas do mês`. Fonte: incidentes registrados (seção 8.5). Sem fonte, use `indisponivel`, não 100%. | medido / indisponível |
| **Áudios** | Áudios recebidos e respondidos pela IA. Duração tirada do metadado do WhatsApp. Quantidade, soma, maior e quantidade > 120 s. | medido |
| **Tempo de texto** | Mensagens de texto respondidas pela IA × parâmetro `segundosPorMensagem` (padrão 30, configurável por conta). | **estimado** |
| **Qualificados** | Usar o critério que o agente já registra. **Invariante:** qualificados ≥ agendados. Se for violado, use status `parcial` e gere pendência "o agente não está registrando a qualificação". | medido / parcial |
| **Coorte de agendamentos** | Avaliações **criadas pelo agente** com data de criação no mês. Status por avaliação: `compareceu` / `faltou` (status do Clinicorp mapeado como presença ou ausência), `aguardando` (data da consulta > hoje), `nao_verificado` (data passou e não há status mapeado). **Nunca** trate `nao_verificado` como falta. | confirmado / não verificado |
| **Taxa de comparecimento** | `compareceram ÷ (compareceram + faltaram)`. Se o denominador for 0, use `indisponivel`. | confirmado |
| **De meses anteriores** | Avaliações criadas pelo agente antes do mês e com consulta no mês. Linha separada; não entram na taxa. | confirmado |
| **Expediente da avaliação** | Herda a classificação do contato que originou o agendamento. | medido |
| **Cidade / fora da área** | Do que o contato disse ao agente (`loadLeadQuality`). Se a cobertura for < 50% dos contatos, use `parcial` e gere a ação "ajustar o agente para perguntar a cidade". | medido / parcial |
| **Motivo principal** | **Um único** motivo por contato não agendado. **Invariante:** soma = contatos − contatos que agendaram. | medido |
| **Comparativo** | Só quando o mês anterior está completo e comparável (conta ativa desde o dia 1, com cobertura mínima). Caso contrário, `comparativo = null` e a coluna não aparece. | — |

## 7. Validador (`validateReport`)

Ele roda ao salvar, antes da redação da IA e no "Fechar". Cada regra gera uma `Issue` com severidade, mensagem, métrica afetada e ação sugerida. As issues alimentam a central de pendências.

**Bloqueantes** (impedem o "Fechar"):
1. Só agente + transferidas ≠ contatos.
2. Total da coorte ≠ compareceram + faltaram + aguardando + não verificado.
3. Expediente + fora ≠ total, em qualquer `Split`.
4. Soma dos motivos ≠ contatos − agendaram.
5. Decisor ausente, ou decisor igual ao contato operacional (D7).
6. Texto da IA com número que não existe em `MonthlyReportData` (ver 9.3).
7. Texto com nome, telefone, e-mail ou data completa de paciente.

**Avisos que viram pendência acionável** (não bloqueiam; sem resolução, o número sai com o status correspondente):
- Qualificados < agendados.
- Transferidas > 0 sem nenhum evento de transbordo, ou o inverso.
- 1ª resposta do agente com mediana > 300 s: investigar a mistura com humano ou o atraso da fila.
- Cobertura de cidade < 50%.
- Status do Clinicorp não mapeados, ou avaliações em `nao_verificado`.
- Expediente da clínica não cadastrado. Nesse caso, o `Split` vira `parcial` e o bloco mostra só o total.

**Não é issue:** falta de ticket, conversão ou custo da equipe (D4). Isso só desativa o bloco de retorno estimado.

## 8. Mudanças por área

### 8.1 Página do cliente — `/relatorios?visao=roi-mensal` (renomear o rótulo para "Relatório mensal")

Renderizar a partir do snapshot, nesta ordem:

1. **Cabeçalho:** clínica, mês, decisor (dono), contato operacional em cópia, período, expediente cadastrado.
2. **Frase de abertura:** gerada pela IA a partir de contatos, agendadas, compareceram e contatos fora do expediente.
3. **4 KPIs:**
   - contatos atendidos (expediente · fora);
   - avaliações agendadas (destaque visual, a âncora);
   - compareceram, com a taxa e as que estão "aguardando";
   - 1ª resposta do agente (mediana).
   Mostrar a variação só se `comparativo != null`.
4. **01 Atendimento:**
   - só agente, transferidas, disponibilidade;
   - tabela de tempo devolvido (áudios + texto, com selo "estimativa");
   - gráfico por faixa horária;
   - tabela da recepção.
5. **02 Agenda:** funil (contatos → qualificados → agendaram → compareceram, com quebra por expediente), tabela da coorte, linha de meses anteriores e tabela por procedimento.
6. **03 O que ajustamos:** ações do mês anterior avaliadas, perguntas sem resposta (mês × anterior), mudanças no agente e caso do mês.
7. **04 Qualidade dos leads:** primeira dúvida, motivo principal (com linha de total), fora da área e sugestão de tráfego.
8. **05 O que não saiu como planejado:** sempre presente (D9).
9. **06 Próximo mês:** até 3 ações, cada uma com responsável e meta.
10. **Retorno estimado:** só se `retornoEstimado != null`, sempre por último.

**Selo de status:** mostrar discretamente só `estimado`, `parcial` e `nao_verificado`. Números `medido` e `confirmado` não levam selo. Cada número com `evidenceIds` mantém o "Ver registros" (rastreabilidade já existente).

### 8.2 Admin — `MonthlyRoiEditor.tsx` e `actions.ts`

- **Etapa 1 (Importar e conferir):** mostrar o resultado do `validateReport`.
- **Etapa 2 (Pendências):**
  - **Obrigatórias:** expediente cadastrado, mapeamento de status do Clinicorp, mensalidade e decisor.
  - **Opcionais** (grupo separado, com o rótulo "ativa o retorno estimado", não contam como área pendente): ticket, conversão e custo da equipe.
- **Etapa 3 (Validar resultados):** mostrar `MonthlyReportData` com status e invariantes. O retorno estimado aparece só se as premissas estiverem completas.
- **Etapa 4 (Análise com IA):** ver a seção 9. Campos estruturados:
  - **Caso do mês:** idade, áudios (lista de durações), dia da semana, período, procedimento, resultado e texto livre. Validação D8.
  - **Próximas ações:** até 3, com título, responsável (`mavellium` | `clinica`), métrica e meta numérica.
  - **Mudanças no agente:** tipo (`incluido` | `regra_nova` | `corrigido`), descrição e data.
- **Etapa 5 (Aprovar e entregar):** prévia do PDF real gerado no servidor.
- **Decisor:** separar em dois campos, `decisor` (dono/sócio, obrigatório) e `contatoOperacional`. O "Registrar entrega" registra o envio e a reunião com o decisor.
- **`fechar()`:** além do que já congela, o snapshot passa a guardar a versão do schema de `MonthlyReportData`, as premissas usadas, o `segundosPorMensagem` e o hash do conteúdo.

### 8.3 Ações do mês anterior

Ao abrir a revisão de um mês, carregar as `proximoMes` do snapshot do mês anterior. Para cada ação, calcular a métrica atual quando houver mapeamento automático (ex.: "faltas abaixo de 15%" → `100 − taxaComparecimento`) ou pedir ao revisor. Status: `funcionou` | `parcial` | `nao_funcionou`, com o número que comprova. Sem mês anterior fechado, a lista fica vazia e o bloco omite a sublista.

### 8.4 Visão Financeiro (`computeFinancialSummary`)

Aplicar D4: sem o valor definido, mostrar só o convite no painel e nada no PDF. Não unificar com o retorno estimado agora; registrar como lacuna/decisão futura no plano.

### 8.5 Incidentes / disponibilidade

Se não houver registro de indisponibilidade:
- Criar a tabela `agent_incidents` (`tenantId`, `inicio`, `fim`, `tipo: agente | integracao | humano`, `descricao`, `contatosAfetados`).
- Permitir o cadastro manual no admin.

Se já existir health check ou log de queda, derivar dele e documentar no plano. Os problemas do bloco 05 vêm daqui, das faltas, das esperas > 1h e das transferências sem resposta.

### 8.6 README

Atualizar o README da seção: "cinco visões", não "três". Documentar `MonthlyReportData`, as definições da seção 6 e as regras do validador.

## 9. Redação com IA

### 9.1 Entrada
A IA recebe **só** o `MonthlyReportData` validado (JSON) e a lista de issues abertas. Ela não acessa o banco diretamente para redigir. O painel "Perguntar à I.A" continua com as ferramentas de leitura, mas as sugestões dele precisam passar por "Salvar revisão" e pelo validador.

### 9.2 Saída
A IA produz, sempre em rascunho:
- a frase de abertura;
- o resumo do período;
- a redação dos problemas;
- a sugestão de até 3 próximas ações;
- as sugestões de tráfego.

Cada afirmação é acompanhada das chaves de métrica que a sustentam. O caso do mês continua sendo escrito à mão.

### 9.3 Guardas
- **Checagem de números:** extrair todos os números do texto e conferir se cada um existe em `MonthlyReportData`, incluindo formatos derivados como "9h40" e "78%". Número sem origem é bloqueante.
- **PII:** bloquear nome, telefone, e-mail e data completa de paciente (ver D8).
- **Problemas:** proibido afirmar problema sem um `Problema` correspondente em `data.problemas` (D9).
- **Linguagem:** "chegaram com a recepção fechada", nunca "seriam perdidos". Retorno sempre como "estimativa".

## 10. PDF

- Gerado **no servidor** a partir do snapshot fechado (ou da prévia do rascunho na etapa 5), usando a mesma árvore de componentes da página.
- **Notas internas nunca entram.** Componentes de nota/admin só existem fora da rota de impressão; não depender de CSS para escondê-los.
- `@media print`: A4, margens de 15 mm, `break-inside: avoid` em blocos e tabelas, `print-color-adjust: exact`, sem barra de ferramentas.
- Página 1 = cabeçalho + frase + KPIs + resumo + próximas ações. O restante segue em páginas de anexo; o número de páginas não é fixo.
- Nome do arquivo: `fechai-relatorio-{slug-clinica}-{YYYY-MM}-v{versao}.pdf`.

## 11. Fixture de aceite

Criar uma fixture (seed de teste) que reproduza o modelo de exemplo. O motor e o validador precisam chegar exatamente a estes valores:

| Métrica | Valor |
|---|---|
| Contatos | 214 (126 no expediente · 88 fora) |
| Só agente / transferidas | 156 / 58 |
| 1ª resposta do agente (mediana) | 38 s |
| Recepção | 55 de 58 respondidas · mediana 22 min · 11 > 1h · 3 sem resposta |
| Disponibilidade | 99,6% (1 incidente de 3h, 6 contatos afetados) |
| Áudios | 37 · 2h05 · maior 6min12 · 14 acima de 2 min |
| Texto | 1.180 mensagens × 30 s ≈ 7h35 (estimado) · total 9h40 |
| Faixas horárias | 0–8h: 14 · 8–12h: 46 · 12–14h: 22 · 14–18h: 58 · 18–22h: 52 · 22–24h: 22 |
| Qualificados | 97 (56 · 41) |
| Coorte (exped. / fora / total) | compareceram 13/8/21 · faltaram 4/2/6 · aguardando 2/1/3 · não verificado 0/1/1 · total 19/12/31 |
| Taxa de comparecimento | 21 ÷ 27 = 78% |
| Meses anteriores realizadas no mês | 2 compareceram |
| Procedimentos | Implante 11 · Orto 8 · Avaliação geral 7 · Clareamento 5 |
| Perguntas sem resposta | 14 (agosto: 23) |
| Cidade informada / fora da área / agendaram | 133 / 29 / 1 |
| Primeira dúvida | Preço 34% · Onde fica 21% · Convênio 18% · Horários 12% · Outras 15% |
| Motivo principal | Parou de responder 112 · Caro 29 · Longe 17 · Adiou 14 · Outros 11 = 183 |
| Retorno estimado (premissas: 35%, R$ 3.200, R$ 25/h, mensalidade R$ 1.490) | 8 × 0,35 × 3.200 = R$ 8.960 · + R$ 242 de economia · − R$ 1.490 = R$ 7.712 · ROI 5,2x |
| Sem premissas | `retornoEstimado = null` e o bloco não aparece |

## 12. Testes obrigatórios

1. **Unidade (motor):** cada métrica da seção 6 com a fixture.
2. **Invariantes:** cada regra bloqueante da seção 7 com um caso que passa e outro que falha.
3. **Fuso:** mensagem às 23:30 do dia 30/09 em Brasília conta em setembro; às 00:10 de 01/10, em outubro.
4. **Expediente:**
   - sábado às 13h = fora;
   - segunda às 7h59 = fora;
   - segunda às 8h00 = expediente.
5. **Coorte:**
   - avaliação criada em 30/09 para 03/10 = `aguardando`;
   - criada em 28/08 e realizada em 02/09 = linha de meses anteriores;
   - data passada sem status = `nao_verificado`, fora da taxa.
6. **D4:** sem uma premissa, `retornoEstimado === null` e o PDF não contém "ROI", "Retorno" nem "Pendente".
7. **D7:** o "Fechar" recusa um decisor igual ao contato operacional.
8. **PDF:** o PDF gerado não contém "Nota interna" nem nenhum texto de componente admin.
9. **IA:** um texto com número inexistente nos dados é recusado; um texto com um telefone é recusado.
10. **Snapshot:** reabrir e fechar de novo preserva a versão anterior e incrementa `versao`.

## 13. Fases de entrega

| Fase | Conteúdo | Para o envio de 05/10? |
|---|---|---|
| **0** | Reconhecimento: mapear arquivos, tabelas e fontes de cada métrica da seção 6, listar lacunas e devolver o plano. **Sem código.** | Sim |
| **1** | Contrato `MonthlyReportData` + motor + fixture + testes 1, 3, 4 e 5 | Sim |
| **2** | Validador + integração com a central de pendências + testes 2 e 7 | Sim |
| **3** | Coorte de agendamentos, decisor/contato operacional e financeiro opcional (D4, D7) + teste 6 | Sim |
| **4** | Nova ordem de blocos na página do cliente e no admin + PDF no servidor + teste 8 | Sim |
| **5** | Guardas da IA (9.3) + teste 9 | Sim, se couber; senão, revisão manual reforçada |
| **6** | Ações do mês anterior, incidentes/disponibilidade, tempo devolvido detalhado, README | Depois de 05/10 |

Ao fim de cada fase: rodar lint, typecheck e os testes, e resumir o que mudou e o que ficou pendente.

## 14. Perguntas em aberto (responder no plano da Fase 0)

1. Onde fica hoje o evento de transbordo? Ele é registrado de forma confiável?
2. O agente grava "qualificado" em algum campo? Com que critério?
3. Qual é o mapeamento atual dos status do Clinicorp e de onde vem a lista de status possíveis?
4. Existe registro de queda do agente (health check, log, tabela)?
5. A duração dos áudios está salva nos metadados da mensagem?
6. Como o "contato" se relaciona com o "lead" hoje? Por que 117 contra 277 no relatório de setembro?
7. Há cadastro de feriados por conta?
