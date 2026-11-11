# Disparos · WhatsApp pela Meta

A página `/disparos` recebe contatos de três origens — **Meus contatos** (leads
da conta, com busca, filtro por estágio e "Selecionar esta página"),
**Digitar ou colar** (um por linha, telefone e nome; colar duas colunas do
Excel funciona) e **Arquivo** (Excel/JSON) —, cria um rascunho com o conteúdo de
cada mensagem e envia somente depois da confirmação do responsável. O arquivo
original não é armazenado. O envio usa templates aprovados da Meta.

Sem arquivo não há colunas: cada espaço `{{n}}` vem do **primeiro nome**
(padrão), do **nome completo** ou de um **texto fixo** igual para todos
(`contacts.ts`).

**Quem não tem nome** (só quando a mensagem usa o nome) tem três saídas,
escolhidas por disparo: **a versão sem o nome** (outro modelo aprovado, com os
mesmos espaços menos o nome), **um texto no lugar do nome** ou **não enviar**.
Se existe uma versão aprovada (`findNamelessVersion`: nome
`<original>_sem_nome` ou o mesmo texto sem o nome), ela vem escolhida. Sem
versão, a tela oferece "Criar versão sem o nome", que abre o editor com
`removeVariables` (tira o espaço e arruma a pontuação) para a pessoa revisar e
mandar aprovar. O disparo guarda a versão em `BroadcastCampaign.namelessTemplate`
e cada contato diz qual recebe em `BroadcastRecipient.variant`
(`main`/`nameless`). Envio usa `recipientTemplate`, e confirmar, retomar,
testar e cada ciclo do worker conferem **todas** as mensagens do disparo
(`templatesStillApproved`). O teste usa um contato com nome quando houver.
Schema novo: `db push` + `generate` nos dois processos. A lista passa pela mesma `parseBroadcastRows` do arquivo, então
valem as mesmas regras de telefone, variável e duplicado. No campo de colar,
número com formato brasileiro sem DDI e sem `+` é **apontado**, nunca aceito
(`11 98765-4321` passaria como DDI 1); o botão "Adicionar +55" corrige por
clique. Na lista da conta, bloqueados e quem pediu para parar aparecem marcados
e não podem ser escolhidos (`contact-search.ts`, sempre com `tenantId`).

## Acesso e configuração

- O menu desktop/celular aparece apenas para quem usa o produto e tem
  `Tenant.metaWhatsappEnabled = true`, liberado em `/admin/contas`.
- Layout, página e todas as actions usam `requireBroadcastAccess()` ou
  `requireBroadcastActor()`: acesso ao produto, conta ativa e Meta habilitada.
  Sem liberação, até o acesso direto é recusado. O tenant vem da sessão.
- Para enviar, configure em `/integracoes` a API oficial: Phone Number ID,
  WABA ID, token e webhook. O token precisa consultar templates
  (`whatsapp_business_management`) e enviar (`whatsapp_business_messaging`).
- `getBroadcastConnection()` exige conexão Meta ativa, conta ativa, liberação
  e credenciais decifráveis. Tokens nunca chegam ao navegador nem à campanha.
  Não há alternativa automática pela Evolution — e ela **não precisa ser
  desconectada** para os Disparos funcionarem: a conta mantém o QR e a Meta de
  pé ao mesmo tempo (ver `modules/whatsapp/README.md`, "Duas conexões ao mesmo
  tempo"). Contato novo criado pelo envio nasce como conversa da Meta; quem já
  fala pelo QR continua nele até responder pela Meta.
- Sem conexão, a página mantém o histórico e orienta a configuração.

## Telas

- **`/disparos`** — lista: busca enquanto digita, filtro por situação, quatro
  números por disparo (enviados, entregues, lidos, responderam) e só a ação
  principal no cartão (Continuar/Descartar rascunho, Pausar, Retomar). Atualiza
  sozinha a cada 5 s **só** quando há disparo enviando e a aba está visível. O
  aviso do serviço de envios aparece só com problema **e** disparo na fila.
  Rascunho descartado (cancelado sem confirmação) some do filtro "Todos".
- **`/disparos/novo`** — passo a passo em 4 etapas (mensagem, para quem,
  revisar e testar, quando enviar), rodapé fixo dizendo o que falta. **Um
  rascunho só**: voltar e revisar de novo atualiza o mesmo (`draftId`), não cria
  outro. `?rascunho=id` retoma na revisão. O teste vem preenchido com o telefone
  do usuário e lembra o último número usado (localStorage).
- **`/disparos/[id]`** — acompanhamento: números, contatos com filtro por
  resultado e busca, exportar planilha, Pausar/Retomar e Cancelar (sempre com
  confirmação). Rascunho redireciona para o passo a passo.

Retornos de ação vão pelo toast (`useSaveFeedback`), nunca por aviso no topo.
Descartar rascunho apaga se nenhum teste saiu; com teste, cancela (o teste foi
mensagem real e conta na atribuição).

## Testar no computador (Meta simulada)

Com `BROADCASTS_SIMULATE_META=1` no `.env` e `NODE_ENV` diferente de
`production`, `getBroadcastConnection` devolve uma Meta falsa
(`simulation.ts`): três templates de exemplo e envio que só devolve um id —
nada sai para a internet. No servidor de produção nunca liga. Para ter
contatos: `npx tsx --env-file=.env scripts/demo-disparos.ts` (só banco local;
30 contatos por conta, 2 bloqueados, 1 pediu para parar). O worker
(`npm run worker`) precisa de Redis para a fila andar.

## Passo a passo para usar

1. Em **Disparos**, clique em **Novo disparo**.
2. Escolha uma mensagem aprovada (escolher já avança). Para planilha, o modelo
   Excel ou JSON baixado já traz as colunas da mensagem escolhida.
3. Em **Para quem**, escolha **Meus contatos** (lista da conta), **Digitar ou
   colar** (um por linha) ou **Planilha** (Excel/JSON, associando as colunas).
   Sem planilha, diga o que vai em cada espaço e o que fazer com quem não tem nome.
4. Clique em **Revisar**. Contatos inválidos são apontados e nada é criado até
   corrigir: uma lista inválida não gera campanha parcial. Duplicados são removidos.
5. Confira os contatos e o texto preenchido. **Enviar teste** envia a mensagem
   do primeiro contato para o número informado, sem iniciar a campanha.
   Use número próprio/autorizado. Cada rascunho permite cinco números de teste,
   um teste por número, separados por pelo menos 30 segundos.
6. Escolha a próxima faixa permitida ou uma data/hora futura, o fuso e a faixa
   diária. O formulário sugere 09:00–18:00; o fim é exclusivo. A faixa vale todos
   os dias, inclusive fins de semana. Pendentes continuam no dia seguinte.
7. Revise o aviso de contatos com envios aceitos nos últimos sete dias. Confirme
   a frequência quando houver aviso e confirme a autorização dos contatos.
   O servidor reconsulta os envios recentes ao confirmar.
8. Confirme os envios. Fechar a página não interrompe a fila. O horário indica
   quando a campanha fica elegível; o início efetivo depende da fila e da Meta.
9. Acompanhe aceitos, entregues, lidos, falhas e resultados. **Ver contatos**
   mostra cada resultado, inclusive testes. **Atualizar contatos** renova essa
   consulta; campanhas e sinal do serviço atualizam automaticamente a cada 5 s.
10. Use **Pausar**, **Retomar** ou **Cancelar**. Pausa preserva pendentes; cancelar
    encerra pendentes. Uma requisição que já saiu para a Meta pode concluir.
    Rascunhos permanecem disponíveis em **Revisar**.

O histórico tem busca por nome, filtro de situação, páginas de 20 campanhas e
**Exportar CSV** de todos os contatos da campanha, com status, datas UTC e autor
da confirmação. O CSV inclui BOM, separador `;`, aspas escapadas e neutralização
de fórmulas para abertura no Excel.

## Arquivos e templates

- Excel `.xlsx`: primeira aba, primeira linha com cabeçalhos preenchidos e
  únicos. Converta `.xls` para `.xlsx`. Arquivos com senha não são aceitos.
- JSON `.json`: lista de objetos; BOM UTF-8 é aceito.
- Até 2 MB, 1.000 contatos e 30 colunas. XLSX tem limite declarado descompactado
  de 20 MB. Células importadas têm até 1.024 caracteres; nomes, até 120.
- O telefone exige DDI e DDD. Pontuação é removida, sem adivinhar país.
  Exemplo: `+55 (11) 98765-4321` vira `5511987654321`. Valida formato, não a
  existência do número no WhatsApp. No Excel, use formato texto.
- Cabeçalhos ignoram caixa, espaços nas bordas e acentos. A associação automática
  reconhece `telefone`/`phone`/`whatsapp`, `nome`/`name` e `var_1`, `var_2` etc.
  É possível selecionar outros nomes de colunas.
- Variáveis precisam estar preenchidas, em uma linha, sem tabulações ou cinco
  espaços consecutivos. A mensagem preenchida aceita até 4.096 caracteres.
- Células selecionadas aceitam apenas texto/números. Fórmulas, objetos e seus
  resultados em cache não são executados nem importados. Colunas não selecionadas
  podem ser ignoradas. O servidor relê o arquivo e valida o mapeamento.
- Telefones repetidos mantêm a primeira linha válida. Celulares brasileiros com
  e sem nono dígito também são deduplicados. O banco separa contato real e teste
  pela chave `(campaignId, phone, isTest)`.

```json
[
  { "telefone": "5511987654321", "nome": "Ana", "var_1": "Ana" },
  { "telefone": "5521987654321", "nome": "Bruno", "var_1": "Bruno" }
]
```

Templates compatíveis: aprovados, cabeçalho de texto fixo **ou de mídia**,
rodapé fixo, até 20 variáveis posicionais no corpo e **botões** (abaixo).
Variáveis nomeadas, botão de telefone/código, link com variável, cabeçalho de
texto com variável e cabeçalho de localização ficam fora.

## Botões (`template-buttons.ts`)

Até 3 botões por modelo, de **um tipo só** (a Meta não deixa misturar):
**resposta rápida** (`QUICK_REPLY`, ex.: "Eu quero", "Bloquear") ou **link**
(`URL` https fixo, sem variável, máx. 2000 caracteres). Texto até 25 caracteres,
sem repetir. `metaButtons` lê o que a Meta devolve; modelo com botão que não
sabemos enviar (telefone, link com variável) some da lista de disparo.

- Botão estático não leva parâmetro no envio: `sendBroadcastTemplate` não muda.
  `sameBroadcastTemplate` compara os botões (modelo trocado = disparo recusado) e
  `Message.content` registra `Botões: Eu quero · Bloquear`.
- **O toque chega como `type: "button"`** no webhook (não `interactive`):
  `meta-events.ts` vira mensagem com o texto do botão e `viaButton: true`. Antes
  isso era descartado em silêncio. "Eu quero" segue o atendimento normal.
- **"Bloquear" / "Parar mensagens" / "Sair"** (`whatsapp/block-button.ts`, só no
  toque do botão): `handleBlockButton` marca `followUpReason: "stop"` (a regra que
  Disparos e follow-up já respeitam), guarda o toque e confirma com texto livre
  (dentro das 24h abertas pelo toque). Fora do turno do agente: sem LLM e sem
  cota; nunca lança. **Não** entra em `WhatsappBlockedNumber` — o agente ainda
  responde se a pessoa escrever. "Cancelar" não conta (é desmarcar consulta).
- Editor (`/disparos/modelos/novo`): seção "Botões" com atalhos; prévia com os
  botões abaixo do balão (`ButtonRow`). Duplicar um modelo traz os botões.

## Imagem, vídeo e documento (`media.ts`, `media-storage.ts`)

A Meta só aceita mídia em disparo **no topo de um modelo aprovado**, em três
formatos: imagem (JPG/PNG, 5 MB), vídeo (MP4/3GP, 16 MB) e documento (PDF,
Word, Excel, PowerPoint, TXT; aqui limitado a 30 MB). **Áudio não existe em
modelo** — só dentro das 24h abertas pelo contato —, por isso não é oferecido.

- `supportedTemplate(raw, { media: true })` aceita o cabeçalho de mídia e marca
  `mediaFormat`. **Só os Disparos pedem `media: true`** (`listBroadcastTemplates({ media: true })`
  nas actions e no worker); os lembretes do Clinicorp/consulta continuam vendo só
  modelos de texto, porque não têm de onde tirar o arquivo.
- `sameBroadcastTemplate` compara também `mediaFormat` (ausente = texto, para
  rascunhos antigos continuarem iguais). A versão sem nome precisa do mesmo tipo.
- **De onde vem o arquivo** (`BroadcastCampaign.media`, `CampaignMedia`):
  - **Mesmo para todos** (`mode: "file"`, vale para as três origens de contato):
    sobe na hora por `uploadBroadcastMedia` para a CDN (Bunny), num caminho
    aleatório `disparos/<tenantId>/<uuid>.<ext>`. Link público e durável — o id
    de mídia da Meta vence em 30 dias e quebraria disparo agendado ou pausado.
    `checkBroadcastMedia` só aceita link com o prefixo da própria conta.
  - **Link na planilha** (`mode: "column"`, só com planilha): coluna escolhida em
    "Link do arquivo" (`ColumnMapping.media`; o modelo baixado traz
    `link_arquivo`). `https`, uma linha, sem usuário/senha; linha sem link
    válido é apontada como os outros erros. Quem baixa é a Meta, não o servidor.
- Cada destinatário guarda o próprio `mediaUrl`/`mediaFilename` (o teste copia
  do contato de exemplo). `send.ts` recusa **antes do claim** mensagem de mídia
  sem arquivo (`failed`, nada sai). Na Meta o link vai em
  `components[type=header]` (`document` leva `filename`).
- Na conversa, `Message.content` leva `[Imagem]`/`[Vídeo]`/`[Documento]` no lugar
  do topo (`renderBroadcast`). Link que a Meta não conseguir baixar volta como
  falha de entrega no recibo, nunca como reenvio.
- **Criar modelo com mídia** (`/disparos/modelos/novo`, "Topo da mensagem"): o
  exemplo vai direto para a Meta pela Resumable Upload API do app
  (`uploadTemplateExample`, via `/app/uploads` com o token da própria conexão)
  e o modelo leva `example.header_handle`. O app é resolvido pelo token, nunca
  pelo `META_APP_ID` global do cadastro incorporado: a configuração manual pode
  usar outro app. O retorno precisa ser um handle de exemplo, nunca ID de mídia
  ou URL; a recusa `2494102` orienta trocar o exemplo. Duplicar um modelo de
  mídia pede o exemplo de novo.
- Simulação: `folheto_campanha` (imagem) e `orcamento_pdf` (documento); sem CDN
  configurada, o arquivo vira um link falso (`simulado.invalid`), que nada baixa.
- Schema novo (`BroadcastCampaign.media`, `BroadcastRecipient.mediaUrl`/`mediaFilename`,
  todos opcionais): `db push` + `generate` nos dois processos.

**Telas de modelos** (aba "Modelos de mensagem"): `/disparos/modelos` é a
lista — filtro por situação com contagem, busca, texto com as variáveis
destacadas e a ação de cada situação (aprovado → "Usar em disparo", que abre
`/disparos/novo?modelo=id` já escolhido; recusado → "Corrigir"; todos →
"Duplicar"). Enquanto houver modelo em análise, a lista se atualiza sozinha.
`/disparos/modelos/novo` é o editor: propósito em dois cartões (aviso ×
promoção), texto com etiquetas de variável (nome, data, horário, outro) que já
trazem o exemplo, título e rodapé recolhidos, nome sugerido pelo texto
(`suggestTemplateName`) e prévia em balão. Os avisos rodam enquanto digita com
a **mesma** `validateTemplateDraft` do servidor, mais `variablesOutOfOrder`
(com "Corrigir numeração") e `looksPromotional` (texto de promoção marcado como
aviso). `?de=id` abre preenchido para corrigir/duplicar com nome `_v2`, `_v3`…
— a Meta não edita modelo recusado. A Meta não informa a data de criação:
`MessageTemplateLog` guarda a dos modelos criados pelo fechai
(`template-log.ts`, nunca lança) e o filtro "Criado em" usa só ela — modelo
criado direto na Meta fica sem data e fora do filtro de período, nunca com data
inventada. Schema novo: `db push` + `generate` nos dois processos.

**Filtros das listas** usam `FilterPopover` (`components/ui/filter-popover.tsx`):
a tela declara os campos (`select` e `period`) e o componente cuida do botão,
do cartão, de abrir/fechar, Limpar/Aplicar e das etiquetas removíveis.

**Criar modelo pelo fechai** (`/disparos/modelos/novo`, mesmo guarda dos Disparos):
o formulário monta exatamente esse formato — `template-draft.ts` valida (nome
`a-z0-9_`, Utilidade ou Marketing, `pt_BR`, variáveis em sequência, corpo que
não começa nem termina em variável, um exemplo por variável) e
`createMessageTemplate` faz `POST /{WABA}/message_templates`. Quem aprova é a
Meta, depois; a lista (`listManagedTemplates`) mostra em análise, aprovados e
recusados com o motivo. **Não contorna a Meta**: conta que ela não autoriza a
gerir modelos (subcode `2494160`) recebe a mesma recusa daqui, com a frase
apontando o suporte da Meta. Falha de rede ao criar não repete o envio — a tela
pede para atualizar a lista antes, porque a Meta pode ter criado o modelo.

O adapter pagina templates por cursor na Graph API, sem seguir `paging.next`
para outro domínio. Template e remetente são congelados no rascunho e revalidados
na confirmação, no teste, na retomada e a cada ciclo da campanha. Alterações não
mudam silenciosamente o conteúdo revisado. Referência do formato:
[Meta — template messages](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/).
Usamos HTTP direto, não o SDK arquivado.

**Não é só dos Disparos.** O lembrete de consulta para quem nunca conversou
com o número (pacientes do Clinicorp) usa as mesmas peças:
`getBroadcastConnection`, `listBroadcastTemplates`/`supportedTemplate` para
escolher, `sameBroadcastTemplate` para conferir ao salvar, `sendBroadcastTemplate`
para enviar e `renderBroadcast` para o texto que entra na conversa. Mudar o
formato aceito ou o envio muda também esses lembretes — ver
`src/modules/scheduling/meta-reminder.ts` e
`workers/follow-up-worker/clinicorp-reminders.ts`.

**Tempo estimado** (`estimate.ts`, tela "Revisar e enviar"): começo, duração
e término aproximados, com a mesma faixa diária da fila e o ritmo de
`BROADCAST_PER_MINUTE` (~60/min, tirado do worker: lotes de 25, 250 ms entre
envios, ~10 s entre lotes). **Agendar** pede data, "começa às" e "último envio
às": o horário de início vira também o início da faixa diária, então o que não
couber até o último envio continua no dia seguinte **no mesmo horário de
início** (nunca à noite). "Assim que possível" mantém a faixa explícita
(padrão 09:00–18:00). Mudou o
ritmo do worker, atualize a constante.

## Fila, pausa e proteção contra duplicação

Após o commit do envio e da mensagem, `recordMessageContext` registra a operação
como `contact_campaign` para o relatório mensal, por id da mensagem. É observação
best-effort: nunca lança nem muda cota/fila ou transforma campanha em tráfego
pago/base qualificada. A conversão por contexto do relatório mede a população
da primeira atividade no período; **não é a atribuição de resultado de uma
campanha**. Esta continua a última campanha antes da resposta, em sete dias,
pelas regras de `outcomes.ts` abaixo.

`BroadcastCampaign`: `draft → queued → completed`, com `queued ↔ paused` e
cancelamento de rascunho/fila/pausa. Guarda agenda, fuso, faixa, próxima tentativa,
erro, datas e confirmação (`confirmedAt`, `confirmedBy`, `confirmedByLabel`,
`consentVersion`). A versão `whatsapp-opt-in-v1` registra a declaração feita pelo
responsável; não substitui a comprovação da autorização obtida por ele.

`BroadcastRecipient` separa execução e entrega:

| Execução | Significado |
| --- | --- |
| `pending` | Aguarda confirmação, horário ou processamento |
| `sending` | Reservado atomicamente antes do envio |
| `sent` | Meta aceitou e devolveu `wamid` |
| `failed` | Falha anterior à requisição ou recusa explícita |
| `unknown` | Resultado incerto; conferir antes de qualquer novo envio |
| `skipped` | Bloqueado ou pediu para parar (`followUpReason: stop`) |
| `cancelled` | Pendente cancelado pelo responsável |

O worker existente tem fila `whatsapp-broadcasts`, varredura a cada 10 s e
concorrência global BullMQ de 1, inclusive com mais de um processo. A base é a
fila durável; não existe publicação Redis individual por contato após o commit.

A consulta PostgreSQL escolhe uma campanha elegível por tenant (`DISTINCT ON`),
ordenada por `nextAttemptAt`, até 20 tenants por ciclo; cada campanha processa
até 25 contatos, com 250 ms entre tentativas. A próxima tentativa avança mesmo
em falhas: recuo de 10 s, 20 s, 40 s… até 5 min. Uma conta indisponível não ocupa
permanentemente todas as vagas. A faixa diária é checada antes de cada contato,
usando exclusivamente as conversões de `scheduling/time.ts`.

Claim condicional (`pending` + estado da campanha) impede duas reservas. Pausa
após o claim e antes da chamada devolve o contato a `pending`. Cancelamento
nesse momento o encerra. Desconexão, revogação da Meta, suspensão e troca do
remetente pausam a campanha, preservando pendentes. Retomar exige o mesmo
remetente e template original aprovado; não restaura destinatários processados.

`sending` há mais de cinco minutos vira `unknown`. Timeout/queda de rede ou
falha de persistência após enviar também ficam incertos. **Nunca reenvie esses
contatos automaticamente**: o provedor pode ter recebido. Não há transação
atômica entre a Meta e nosso banco nem promessa de exatamente uma entrega.
Falhas e incertos exigem revisão antes de criar outro disparo.

Antes de cada envio, inclusive teste, são checados bloqueio, pedido para parar,
conexão e estado da campanha. **Ignorado não é definitivo enquanto nada saiu**:
testar de novo um número de teste ignorado reconfere o motivo, e desbloquear um
número em Integrações devolve à fila os destinatários pulados por bloqueio em
disparos na fila ou pausados (`unblock.ts`, nunca lança). Disparo concluído ou
cancelado fica como estava. Falha ao ler bloqueios interrompe o processamento.
Aceitos entram na conversa como `assistant` / `sentBy: human`, sem LLM nem cota
de respostas da IA. A resposta futura do contato segue o atendimento normal.
Testes são mensagens reais e entram no histórico, mas seus destinatários não
entram nos totais da campanha nem na seleção da fila. Teste `skipped` (barrado
por bloqueio ou pedido de parar, sem chamada à Meta) é **reavaliado** ao pedir de
novo: desbloquear o número destrava o teste. `sent`, `unknown` e `failed`
seguem devolvendo o resultado anterior, para não duplicar envio.

## Entrega, lote de eventos e resultados

O webhook assinado processa todas as entradas/mudanças/mensagens/recibos,
filtrando pelo Phone Number ID da conta autenticada. Um evento com falha não
impede os restantes e gera resposta 500 para reentrega. Textos e áudios guardam
o ID de entrada e duplicados registrados não repetem o turno. A deduplicação
vem antes do controle de rajada; eventos Meta novos limitados pedem reentrega.
Um turno já registrado que falhou depois não é repetido automaticamente — esse
caso ainda exige acompanhamento da conversa, evitando resposta duplicada.

`deliveryStatus` é separado: `sent`, `delivered`, `read` ou `failed`. Leitura
prevalece sobre entrega, entrega sobre falha, e um `sent` atrasado não regride
nenhum resultado. Entregues incluem lidos. Falha posterior à aceitação não
reabre envio. A Meta pode não fornecer confirmação de leitura.

`BroadcastReceipt` é inbox idempotente: conserva retorno que chega enquanto o
worker ainda está enviando, antes de gravar o `wamid`. Depois do commit, o worker
reconcilia por tenant + ID da mensagem + remetente + destinatário. Outra varredura
reaplica pendências. Sem correspondência após 10 min, encerra a reconciliação
sem deduzir entrega pelo telefone: o envio segue incerto. Recibos de campanhas
anteriores ainda são aceitos quando o número está desconectado localmente, desde
que a Meta continue liberada e a assinatura seja válida. Excluir tenant remove
seus recibos em cascata.

Atribuição operacional (não causal): ao registrar uma resposta, escolhe o último
envio aceito antes do instante original da mensagem, dentro de sete dias e no
mesmo tenant/telefone. Se o último envio foi um teste, não atribui à campanha
anterior. Primeira resposta conta uma vez; duplicatas não mudam a data.
Oportunidade conta se o contato está `hot`/`scheduled` ao processar uma resposta
e não estava nesses estados no envio. Consulta conta uma vez por destinatário
se criada após o envio, dentro dos sete dias, não cancelada quando observada.
São fotografias históricas: cancelamentos e alterações manuais posteriores não
reescrevem esses números. Agendamentos sem nova resposta não são atribuídos.

## Diagnóstico e operação

`WorkerHeartbeat` guarda sinal a cada 15 s, última varredura concluída e erro.
Sinal exige processo executando e uma consulta ao Redis; expira após 60 s. É
independente da duração da varredura. Não prova que a Meta está disponível:
falhas da integração aparecem no próprio disparo.

O projeto usa **db push**, sem migrations. Atualize web e worker juntos:

```bash
npm install
npx prisma db push
npx prisma generate
npm run worker
```

Além de campanhas/destinatários, há tabelas de recibos e sinal do serviço.
Campanhas antigas mantêm faixa de dia inteiro; campos novos têm defaults ou
aceitam null. A unicidade dos contatos agora inclui `isTest`. Se `db push` avisar
sobre índices únicos, confira duplicatas antes de aceitar o aviso. No Windows,
pare servidor/worker se `generate` encontrar lock da DLL e reinicie após gerar.
Não há variável nova: banco, Redis, `ENCRYPTION_KEY` e versão Graph existentes.
Sem processo de worker ativo, envios confirmados continuam aguardando na base.

## Mapa e validação

- `access.ts`, `connection.ts`: acesso e integração.
- `import.ts`, `phone.ts`, `template.ts`: leitura, normalização e conteúdo.
- `template-draft.ts` + `src/app/(dashboard)/disparos/modelos/`: criar modelo e acompanhar a aprovação.
- `schedule.ts`, `queue.ts`, `worker.ts`, `send.ts`: horário, distribuição e envio protegido.
- `receipts.ts`, `outcomes.ts`, `recent.ts`: retorno, atribuição e frequência.
- `queries.ts`, `csv.ts`, `health.ts`: histórico, exportação e diagnóstico.
- `src/app/(dashboard)/disparos/`: página, compositor, revisão, histórico/actions.
- `src/modules/whatsapp/meta-events.ts`: parser de todos os eventos Meta.
- `workers/follow-up-worker/index.ts`: agenda da fila e sinal periódico.

```bash
npm test
npx tsc --noEmit
npm run build
npx tsx scripts/check-broadcasts-db.ts
```

Os testes simulam a Meta e cobrem autorização entre tenants, importação real de
XLSX, mapeamento, agenda/fuso, consentimento, testes idempotentes, pausa,
concorrência, falhas, callbacks antecipados/fora de ordem, lotes, atribuição e
exportação. Não enviam mensagens reais.
O último comando verifica a consulta real de distribuição entre 25 tenants,
JsonB, claim e unicidade num banco **local**, sempre com rollback, sem worker.
