# Módulo: lead-insights (inteligência de conversas)

> Produto e implantação: [`docs/inteligencia-de-conversas.md`](../../../docs/inteligencia-de-conversas.md).
> Origem: Obsidian → Produto/Fechai/Fechai - Inteligência de Conversas (não estava disponível ao implementar; o escopo veio do pedido).

## O que faz

**Revisão de contexto (01/10/2026):** a leitura atual inclui atendimento de
pacientes antigos e contatos abordados pela clínica. Sem origem de aquisição
registrada, não presume tráfego pago: `acquisition: "not_recorded"`, sem
sugestões de segmentação a partir dessa base misturada. O classificador de
iniciativa/conversão é `reports/contact-context.ts`; os registros históricos
continuam congelados. Cidade conhecida não comprova aquisição por anúncio.

Mede a qualidade dos leads do tráfego pago: de que cidade são, se estão dentro
do raio de atendimento, o que perguntam primeiro, por que não fecham e o que
aconteceu com eles. O caso que originou: o Instituto do Sorriso fica em Garça e
os leads de Marília quase nunca fecham — parte da verba compra lead que não
converte, e ninguém media.

```text
contato diz cidade/dúvida/motivo ─► agente chama record_lead_insight ─► ConversationInsight (1 por conversa)
                                                                              │
Lead + Appointment + ReportEvent + follow-up ──► resultado (calculado) ◄──────┤
TenantServiceArea (cidades atendidas) ──► dentro/fora do raio (calculado) ◄───┘
                                                  ▼
            /relatorios?visao=leads · relatório mensal (bloco + 2ª página do PDF)
```

## Arquivos

- `categories.ts` — puro. `DOUBT_CATEGORIES`, `LOSS_CATEGORIES`, `parse*Category` (valor estranho vira `outro`, ausente é `null`), rótulos, `IDLE_LOSS_KEY` (`sumiu`, derivado).
- `city.ts` — puro. `cleanCity`, `normalizeCity` (sem acento, caixa e UF final), `sameCity` (erro de 1 letra só em nome com 6+ letras).
- `service-area.ts` — puro. `ServiceArea`, `parseServiceArea` (nunca lança), `classifyCity` → `in | out | unknown`, `serviceAreaFormSchema`.
- `service-area-store.ts` — `getServiceArea` (nunca lança), `saveServiceArea`.
- `record.ts` — `recordLeadInsight` (**nunca lança**), `scrubInsightText`.
- `tool.ts` — schema da tool `record_lead_insight`, `leadInsightRule()` (vai no prompt de todo turno com agente) e o texto de retorno.
- `summary.ts` — puro. `leadOutcome`, `summarizeLeadQuality`, `trafficSuggestions`, `leadQualityHeadline`.
- `queries.ts` — `loadLeadQuality(tenantId, { from, to }, { agentIds? })`: só metadados, nenhum nome/telefone/texto de conversa.

Telas: `(dashboard)/relatorios/LeadQualityView.tsx` (aba **Qualidade dos leads**),
`(dashboard)/configuracoes/ServiceAreaForm.tsx` (card **Área de atendimento**) e
`LeadQualityCard` em `relatorios/MonthlyView.tsx`. PDF: `reports/monthly-pdf.ts`.

## Contratos expostos

```ts
recordLeadInsight({ tenantId, conversationId, city?, procedure?, firstQuestionCategory?, firstQuestionText?, lossReasonCategory?, lossReasonText? })
  -> { status: "saved" | "empty" | "test" | "failed", fields: string[] }   // nunca lança
getServiceArea(tenantId) -> ServiceArea | null                            // nunca lança; null = não configurada
saveServiceArea(tenantId, { baseCity, cities }) -> { ok: true, area } | { ok: false, error }
loadLeadQuality(tenantId, { from: Date | null, to: Date }, { agentIds?, now? }) -> LeadQuality
loadLeadQualityDetail(tenantId, range, options) -> { quality, leads: LeadEvidence[] }  // um registro por lead, para o relatório mensal
summarizeLeadQuality(rows, area, now) -> LeadQuality                      // puro
leadOutcome(row, now) -> { outcome: "scheduled" | "handoff" | "lost" | "open", lossKey }
classifyCity(area, cityKey) -> "in" | "out" | "unknown"
```

## Regras que não podem quebrar

**Só o que o contato disse, nunca deduzido.** Cidade, procedimento, dúvida e
motivo entram por `record_lead_insight`, chamada pelo agente. Para recuperar
conversas anteriores ao registro estruturado, a cidade também pode vir de uma
declaração literal reconhecida por `historical-city.ts`; não se infere localização.
A tool
proíbe deduzir cidade por DDD, nome ou sotaque, e o servidor descarta o que não
parece cidade (frase, número, link). O agente **não pergunta** a cidade só para
preencher o registro — quem quiser cobertura maior pede isso na persona.

**Histórico de cidades (01/10/2026).** A pedido da revisão do Instituto do
Sorriso, `historical-city-store.ts` lê o histórico dos contatos atendidos, até
o fim exclusivo da janela, em lotes paginados. Aceita declaração como “sou de
Marília” ou resposta contendo só a cidade depois de pergunta dirigida ao
contato. Exige nome exato normalizado da lista pública de municípios do IBGE
(`municipalities.json`, obtida de
`https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome`
em 01/10/2026). Nunca aceita DDD, endereço, localização da clínica, fala de
terceiros ou correspondência aproximada. Conservador: grafia não reconhecida,
frase ambígua e cidades estrangeiras não viram registro. A última declaração
reconhecida antes do corte é usada apenas quando não há cidade estruturada.
Nenhum GET grava. Texto é usado somente no servidor; a evidência guarda id da
mensagem e data, sem seu conteúdo. Snapshots aprovados não são recalculados.

**População alinhada ao mensal v2.** `loadLeadQualityDetail` conta contatos
que escreveram e receberam resposta atribuída à IA ou à equipe na janela,
inclusive leads criados antes dela. Usa `contactActivity`, a mesma regra de
`MonthlyReportData.service.contacts`. Não confundir com **leads novos**, que
continuam sendo criação no período. Sem cidade reconhecida significa ausência
de evidência reconhecida, não prova de que ninguém disse a cidade. **Agendou
segue a coorte do mensal (20/11/2026)**: só conta a avaliação marcada pelo
agente (`isAgentEvaluation`, com as premissas do mês — a revisão ou a herdada),
não cancelada e **criada dentro da janela**. Antes contava qualquer agendamento
do contato, de qualquer data: outubro saía com 29 "agendou" contra 23 no mensal,
e o número de um mês fechado mudava quando alguém marcava no mês seguinte.
Envio automático (lembrete, disparo, follow-up) também não conta como resposta
na população de atendidos, como no mensal.

**Dentro/fora do raio e resultado são calculados na leitura, nunca gravados.**
Gravá-los congelaria um palpite velho quando a clínica muda a área ou o lead
volta a conversar. A área é uma **lista de cidades por nome** (a cidade-base
mais as atendidas), não quilômetros: qualquer cidade fora da lista é "fora".
Sem área configurada o veredito é `unknown` — nunca "dentro" presumido — e o
painel/relatório avisam em vez de mostrar 0% fora do raio. Mesmo nome de cidade
em outro estado é tratado como a mesma cidade (a UF é ignorada na comparação).

**Resultado do lead** (`leadOutcome`), em ordem: agendou (algum agendamento
não cancelado na lista que a leitura entrega — em `loadLeadQualityDetail`, só a
avaliação do agente criada na janela) > transbordou (`needsHuman` ou evento `handoff`) > perdeu >
em andamento. **Perdeu** só com sinal explícito — motivo registrado pelo agente,
triagem (`disqualifiedAt`), follow-up de quem recusou/pediu para parar, status
`lost` — ou depois de `IDLE_AFTER_HOURS` (72h) sem resposta do contato
(`sumiu`, derivado, o agente nunca o declara). Antes disso é "em andamento":
chamar de perdido um lead de ontem inflaria a perda do mês corrente.

**Um único motivo principal por lead que não agendou** (`LeadQuality.notScheduled`):
`leadOutcome` devolve um desfecho só, então cada lead entra em uma linha só e a
soma é **exatamente** `leads − outcomes.scheduled`. A lista não tem corte de
ranking (cortar quebraria a soma) e inclui, além dos motivos de perda, "Em
atendimento com a equipe" (transbordou) e "Ainda em conversa" (em andamento).
É a tabela "Motivo principal de não agendar" do relatório mensal. `losses`
continua existindo para o painel, com os seis maiores motivos de perda.

**A coorte é o lead criado no período** (`Lead.createdAt`, `isTest: false`), com
ou sem registro. Quem não disse a cidade conta em "leads", não em "informaram a
cidade" — a cobertura aparece sempre ao lado do percentual. Conversa de teste
fica fora (a tool responde `test` e não grava).

**A primeira dúvida é gravada uma vez** (`updateMany ... firstQuestionKey: null`);
cidade, procedimento e motivo de perda guardam o último valor dito. Registrar
nunca lança nem derruba o turno; escreve por `findFirst` com `tenantId`, nunca
por id cru.

**Sugestões de tráfego são regra, não IA** (`trafficSuggestions`): o relatório
não chama modelo, e sugestão de verba não pode variar entre gerações. Só saem
com `MIN_SAMPLE` (10) leads com cidade informada; "fora do raio" pede 5+ leads e
20%+; dúvida/motivo pede 25%+ das registradas. São hipóteses para a agência,
**nunca promessa** — o relatório e o PDF dizem isso (`SUGGESTION_DISCLAIMER`).

**LGPD:** nenhuma consulta desta pasta devolve nome, telefone ou trecho de
conversa. O texto livre (`firstQuestionText`, `lossReasonText`) é limpo de
e-mail/telefone antes de gravar e ainda não aparece em tela (base da fase 2).

## Relatório mensal

`computeMonthlyReport` calcula `MonthlyReport.leadQuality` **só do mês** (sem
comparativo), no escopo de agentes da revisão, e o snapshot o congela. Ausente
em relatórios fechados antes do bloco = "sem registro", nunca zero; falha na
consulta tira o bloco, não o relatório. No PDF, o bloco entra na **análise
detalhada** (páginas seguintes ao resumo executivo) só com `leadQuality.leads > 0`;
a página 1 não muda. Mês sem leads ou relatório antigo não ganha o bloco.

O relatório usa `loadLeadQualityDetail`, que devolve o mesmo agregado e, lead a
lead, o que o compôs (`MonthlyEvidence.leads`: id do lead e da conversa, data,
cidade dita, veredito do raio, resultado, motivo e dúvida — calculados pelas
**mesmas** `leadOutcome`/`classifyCity` da leitura). É o "Ver registros" do
bloco no painel; o PDF não leva a lista. Continua sem nome, telefone ou texto.

## Schema

`TenantServiceArea` (uma linha por tenant) e `ConversationInsight` (uma por
conversa, `conversationId @unique`, cascata). Categorias são `String`, não enum:
a fase 2 acrescenta as aprovadas pela equipe. Mudança de schema pede
`prisma db push` + `prisma generate` **nos dois processos** (web e worker).

## O que NÃO faz (fase 2, depois de ~1 mês de dados)

- Não sugere categorias novas quando um motivo "outro" se repete, nem tem a aprovação da equipe no painel.
- Não exporta para a agência de tráfego (TegBe ou outra).
- Não usa quilômetros nem coordenadas: o raio é uma lista de cidades.
- Não mostra o texto livre das dúvidas/motivos, só as categorias.
- Não pergunta a cidade ao contato: registra quando ele diz.
- Não tem passo no wizard de onboarding: a área se configura em `/configuracoes` (a Mavellium edita personificando a conta).
