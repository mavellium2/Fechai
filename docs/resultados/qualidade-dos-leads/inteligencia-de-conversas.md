# Inteligência de conversas — qualidade dos leads do tráfego

Implementação do MVP do documento **Produto/Fechai/Fechai - Inteligência de
Conversas** (Obsidian, indisponível ao implementar: o escopo veio do pedido).
Contrato técnico e regras: [`src/modules/lead-insights/README.md`](../../../src/modules/lead-insights/README.md).

## O problema

Instituto do Sorriso: os leads do tráfego pago abrem com a mensagem padrão do
anúncio e logo perguntam se a clínica é em Marília. A clínica fica em Garça, e o
lead de Marília quase nunca fecha. Parte da verba compra lead que não converte, e
ninguém media isso.

## O que o agente registra de cada conversa

| Dado | Como | Observação |
| --- | --- | --- |
| Cidade | `city` da tool `record_lead_insight` | Só se o contato disse; nunca por DDD. |
| Dentro/fora do raio | **calculado** na leitura | Cidade dita × área de atendimento de hoje. |
| Procedimento | `procedure` | Só se o contato disse. |
| Primeira dúvida real | `first_question_category` + `_text` | Depois da saudação/mensagem pronta do anúncio; gravada uma vez. |
| Motivo de perda | `loss_reason_category` + `_text` | Também derivado: `sumiu` (72h sem resposta), triagem, follow-up. |
| Resultado | **calculado** | Agendou > transbordou > perdeu > em andamento. |

Categorias de dúvida: localização, preço, convênio, forma de pagamento, horário,
procedimento, outra. Motivos de perda: fora da região, achou caro, sem convênio,
horário não serve, escolheu outra clínica, vai pensar, sem interesse, outro — e
o derivado "parou de responder".

## Onde aparece

- **Painel:** `/relatorios` → aba **Qualidade dos leads**, com o seletor de
  período. Leads no período, % que informou a cidade, % fora do raio, agendamentos
  dentro/fora, cidades, primeiras dúvidas, motivos de perda, resultado e as
  melhorias sugeridas.
- **Relatório mensal:** bloco **Qualidade dos leads e melhorias para o tráfego**
  na tela e uma **segunda página** no PDF (só quando o mês tem leads). Exemplo
  gerado pelos dados: "Dos 200 leads, 122 informaram a cidade: 62 eram de fora do
  raio (48 de Marília), e 1 deles agendou. Dentro do raio, 30 de 60 agendaram."
  Melhorias (regra, não IA): restringir a segmentação ou excluir a cidade;
  colocar "em Garça" no anúncio; incluir o endereço na mensagem de boas-vindas
  — mais preço/pagamento e convênio quando dominam. **São sugestões, não
  promessa**, e só saem com 10+ leads que informaram a cidade.

## Configuração (dependência)

O raio é uma **lista de cidades por nome**: a cidade da clínica e as outras que
ela atende, em **Configurações → Área de atendimento**. O campo da cidade nasce
sugerido pelo cadastro (`Tenant.city`), mas só vale depois de salvar. A Mavellium
configura personificando a conta ("Entrar como"). Sem área configurada, o painel
e o relatório dizem isso e não mostram "% fora do raio". Não há passo no wizard
de onboarding.

Para o Instituto do Sorriso: cidade da clínica **Garça**, e as cidades vizinhas
que a clínica realmente atende — o que estiver fora da lista conta como fora.

## Limites conhecidos

- **Cobertura:** só entra quem disse a cidade. O agente não pergunta para
  preencher o registro; se a clínica quiser mais cobertura, peça na persona
  ("pergunte a cidade do paciente"). A cobertura aparece ao lado do percentual.
- **Sem histórico:** conversas anteriores à implantação não têm registro; o
  relatório mostra "informaram a cidade" com o que existe, sem reconstruir.
- **Nome de cidade repetido em outro estado** conta como a mesma cidade.
- **"Perdeu" por silêncio** depende de `IDLE_AFTER_HOURS` (72h); leads recentes
  ficam "em andamento".

## Fase 2 (depois de ~1 mês de dados)

Categorias novas sugeridas pelo agente quando um motivo "outro" se repete, com
aprovação da equipe no painel antes de contar, e exportação para a agência de
tráfego (por exemplo, a TegBe). Não implementadas: o schema já usa chaves de
texto e guarda o texto livre justamente para isso.

## Implantação

Mudança de schema: `npx prisma db push` e `npx prisma generate` **nos dois
processos** (web e worker) e reiniciar ambos (no Windows, feche o `next dev`
antes do `generate`). Não há migração de dados: contas sem linha em
`TenantServiceArea` ficam "não configuradas". A tool passa a existir para todo
agente no primeiro turno depois do deploy. Relatórios mensais já fechados
continuam sem o bloco.

Validação: `tests/lead-insights.test.ts` (cidade, área, resultado, agregação,
sugestões), `tests/lead-insights-record.test.ts` (registro, tool, isolamento) e
`tests/lead-insights-relatorio.test.ts` (PDF de 1 e 2 páginas). Amostra
fictícia: `npx tsx scripts/preview-monthly-roi.ts` gera `tmp/roi/roi-com-leads.pdf`.
