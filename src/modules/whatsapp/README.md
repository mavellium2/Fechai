# Módulo: whatsapp

## O que faz

Conecta o número de WhatsApp do tenant e troca mensagens atrás de uma interface
que isola o provedor. Uma conta tem até **uma conexão por provedor**:
**Evolution API self-hosted** (QR code) e **WhatsApp Cloud API oficial da Meta**,
e com a Meta liberada as duas ficam de pé **ao mesmo tempo**, cada uma com o seu
número. Contas antigas continuam só com a Evolution.

## Arquivos

- `provider.ts` — interface `WhatsAppProvider` (`createInstance`, `getQrCode`, `sendMessage`, `parseWebhook`) e tipos (`IncomingMessage`, `WhatsAppStatus`).
- `evolution.ts` — `EvolutionProvider`: chama a Evolution API v2 (`/instance/create`, `/instance/connect`, `/message/sendText`) e faz parse do evento `messages.upsert`. `isConfigured()` = tem URL+key.
- `meta.ts` — `MetaCloudProvider`: Graph API oficial (texto, upload/download de
  áudio, perfil do número, inscrição do app no WABA e parse de webhook).
- `meta-config.ts` — resolve o adapter pela linha `WhatsappInstance`, decifra
  credenciais e valida `X-Hub-Signature-256` sem vazar segredo.
- `instances.ts` — as conexões da conta e **por qual delas se fala com cada
  contato** (`listWhatsappChannels`, `pickWhatsappChannel`,
  `setConversationChannel`, `summarizeWhatsappStatus`). Ver "Duas conexões ao
  mesmo tempo".
- `process-incoming.ts` — fluxo comum depois que cada webhook foi autenticado e
  normalizado: bloqueio, áudio, conversa, agente, voz e resposta. Anota em
  `Conversation.whatsappProvider` por qual número o contato falou.
- `index.ts` — factory dos adapters e nomes aceitos (`evolution | meta`).
- `blocklist.ts` — números que o agente ignora (`isPhoneBlocked`,
  `canonicalPhone`, `listBlockedNumbers`). Ver abaixo.
- `health.ts` — detecta número fora do ar (`checkTenantWhatsapp`, `scanWhatsappHealth`, `diagnose`), sincroniza `WhatsappInstance.status` com a realidade e garante periodicamente o webhook da Evolution.
- `incidents.ts` — registro das quedas (`WhatsappIncident`), a base da
  "disponibilidade do agente" do relatório mensal. `trackWhatsappIncident(health)`
  é chamada pelo monitor a cada checagem e **nunca lança**: abre incidente só com
  queda **confirmada pelo provedor** (`reachable` e conexão não aberta, com o
  banco achando que estava conectada), fecha quando a conexão volta, e marca
  `Tenant.uptimeTrackedSince` na primeira varredura. `silencioso` (suspeita) e
  `indeterminado` (não deu para perguntar) não abrem nem fecham nada.
  `closeWhatsappIncidents` também roda quando a pessoa desconecta pelo painel:
  desligado por decisão não é queda. Mudança de schema: `db push` + `generate`
  na web e no worker.

## Contratos expostos

```ts
getWhatsAppProvider(name, credentials?): WhatsAppProvider
getWhatsAppProviderForInstance(instance): WhatsAppProvider
createInstance(tenantId) -> { externalId, status, qrCode? }
getQrCode(externalId) -> { status, qrCode? }        // GERA um QR (gasta QRCODE_LIMIT)
getConnectionState(externalId) -> { status, exists, reachable }  // só LÊ, nunca gera
sendMessage(externalId, toPhone, text)
sendGroupMessage(externalId, groupId, text)  // opcional, Evolution; nunca altera participantes
disconnect(externalId)
ensureWebhook(externalId) -> boolean   // false = sem URL/segredo para apontar
parseWebhook(payload) -> IncomingMessage | null
```

## Seleção por conta e credenciais da Meta

Disparos em lote pela Meta vivem em `/disparos`, com importação Excel/JSON,
templates aprovados e fila própria. Consulte
[`modules/broadcasts/README.md`](../broadcasts/README.md) antes de alterar esse fluxo.
O parser `meta-events.ts` percorre o lote inteiro, associa contatos por `wa_id`
e separa mensagens de recibos. A rota autentica a assinatura e filtra cada evento
pelo Phone Number ID. Recibos atualizam a entrega dos disparos sem reabrir envios;
o inbox cobre retornos anteriores ao commit. Textos também persistem o ID de
entrada para deduplicar reentregas; controle de rajada na Meta pede reentrega.

`Tenant.metaWhatsappEnabled` nasce `false` e só o superadmin altera em
`/admin/contas`. Sem essa liberação o cartão da Meta não aparece em
`/integracoes`, as Server Actions recusam o cadastro/reconexão e o webhook
oficial não aceita a conta. Desabilitar com a Meta conectada **desconecta só a
linha Meta** (a Evolution é outra linha e segue atendendo) e preserva as
credenciais cifradas.

`WhatsappInstance` tem **uma linha por provedor e por conta**
(`@@unique([tenantId, provider])`). `provider` nasce como `evolution`, e conta
antiga tem uma linha só — o `db push` não muda nenhuma delas. Para Meta,
`externalId` é o **Phone Number ID** e os demais dados ficam na linha dela:

- Phone Number ID, WABA ID e telefone de exibição podem ficar legíveis;
- access token, App Secret e verify token são cifrados com AES-256-GCM usando
  `ENCRYPTION_KEY` (`meta*Encrypted`);
- credencial ilegível nunca vai crua/cifrada para um header: o adapter fica
  `isConfigured() === false` e a tela pede nova configuração.

### Duas conexões ao mesmo tempo

Antes a conta tinha uma linha só, e trocar de provedor exigia desconectar a
outra — para não terem Evolution e Meta processando o mesmo número. Agora as
duas convivem, **com números diferentes** (o mesmo número não atende pelas duas
conexões: a mensagem chegaria pelos dois webhooks e o agente responderia duas
vezes). A tela diz isso no cartão da Meta.

Como a mensagem sai depende de **por onde o contato fala**, e isso é decidido em
um lugar só (`instances.ts`):

- **Registro.** `Conversation.whatsappProvider` (`evolution` | `meta` | null) é
  gravado por `processIncomingWhatsapp` a cada mensagem do contato — a última
  vence — e também quando o atendente escreve pelo próprio celular. Eco da
  própria resposta não conta. Disparos e o lembrete do Clinicorp criam a
  conversa como da Meta (`onlyIfUnset`: quem já fala pelo QR não é tomado, porque
  o template não abre a janela de 24h). A primeira resposta manual a um contato
  cadastrado à mão também fixa o número por onde saiu.
- **Escolha.** `pickWhatsappChannel(canais, conversa.whatsappProvider)`: com o
  provedor do contato, só a conexão **dele**; sem registro (conversa antiga, do
  site, contato novo), a única de pé ou, com as duas, a Evolution — o padrão de
  antes da Meta existir.
- **Nunca cruzar.** Com o número do contato fora do ar o envio **espera**, não
  vai pelo outro: pelo QR seria primeiro contato (o que mais leva ao bloqueio do
  número da clínica) e pela Meta o texto livre fora da janela é recusado. O
  follow-up e o lembrete não consomem a etapa; a resposta manual mostra qual
  conexão reconectar; a retomada de perguntas deixa o contato pendente
  (`waiting`).
- **Conversas anteriores à coluna.** Quando a segunda linha vai nascer,
  `stampLegacyConversations` marca as conversas sem canal com o provedor da linha
  que já existe (só ela existia). Cai no padrão (Evolution) se isso nunca rodou.
- **O que é sempre de uma conexão só.** Grupos (aviso da transferência, aviso das
  perguntas sem resposta, lista de grupos) são do QR: a Meta não os tem. Disparos
  são da Meta (`getBroadcastConnection`). Pausar o agente, ignorar grupos e a
  lista de bloqueados são da **conta**, não de um número.
- **Lembretes do Clinicorp** escolhem por paciente: quem já conversou pelo QR
  recebe o texto por lá; quem nunca falou, ou fala pela Meta, recebe o template
  aprovado pela Meta. Nunca primeiro contato pelo QR.
- **Número só de recebimento** (`WhatsappInstance.agentReplies`, nasce `true`):
  desligado em `/integracoes` (hoje a chave fica no cartão da Meta), quem
  escreve para aquele número entra em Conversas e o agente **não** é chamado —
  nem resposta, nem follow-up, nem "responder pendente". É o "Meta só para
  Disparos" enquanto o QR atende. Não desvia para o outro número (mesma regra de
  nunca cruzar); a equipe responde à mão dentro da janela de 24h.
- **Estado em uma palavra** (início, onboarding, admin): conectada se **qualquer**
  conexão atende (`summarizeWhatsappStatus`).
- **Abrir `/integracoes` não cria instância na Evolution** de conta que só usa a
  Meta: com a Meta liberada e sem instância do QR, o código só é gerado no clique.

## Webhook oficial da Meta

### Conexão pelo botão da Meta (coexistência)

`MetaEmbeddedSignup` em `/integracoes` abre o Cadastro Incorporado v4 com
`featureType: whatsapp_business_app_onboarding`. O código OAuth é trocado
imediatamente no servidor; IDs do evento são conferidos na Graph API. A conta
só fica conectada com `CLOUD_API`, `is_on_biz_app=true` e `CONNECTED`. O app do
celular permanece ativo; nunca chamar register/deregister nesse fluxo.

Configuração, deploy e links do app estão em
[`docs/META_COEXISTENCIA.md`](../../../docs/META_COEXISTENCIA.md). Arquivos:
`embedded-signup*.ts`, `/api/integrations/meta/signup`, callback compartilhado
`/api/webhooks/whatsapp/meta` e `meta-webhook-handler.ts`. O callback antigo por
tenant permanece disponível. No compartilhado, assinatura + WABA + telefone
delimitam a conta; o segredo do app salvo precisa corresponder ao parceiro.

`metaCoexistenceSync` registra pedidos únicos de sincronização (db push +
generate na web/worker). Resultado `unknown` nunca é repetido. O histórico e
contatos antigos são reconhecidos, sem importação nem turno de IA. Ecos novos
do celular entram como humano, pausam o agente e não atribuem resposta a
campanha. Eventos de remoção desconectam só a Meta, preservando credenciais.
Consulta de perfil 200 não prova conexão: o adapter também verifica plataforma
e status ao salvar/reconectar e na checagem de saúde.

Cada tenant recebe uma Callback URL própria:

`/api/webhooks/whatsapp/meta/{tenantId}`

O `GET` responde ao handshake somente se `hub.verify_token` bater, em tempo
constante, com o token aleatório cifrado da conta. O `POST` lê o corpo bruto e
valida `X-Hub-Signature-256` (HMAC-SHA256 com o App Secret) **antes** de fazer
parse ou chamar o motor. O `phone_number_id` do payload ainda precisa bater com
o salvo no tenant. Eventos de status (`sent`, `delivered`, `read`) são ignorados;
somente `messages` entra no atendimento.

No painel da Meta é obrigatório assinar o campo `messages`. A action também
tenta `POST /{WABA-ID}/subscribed_apps`, mas mantém as credenciais válidas e
mostra um aviso se o token não tiver permissão para fazer essa inscrição.

### Diferenças funcionais da API oficial

- Não existe QR nem sessão de aparelho. Conectar valida Phone Number ID + token.
- A Cloud API oficial não oferece o envio ao grupo interno. A transferência
  para humano continua marcando a conversa, mas o extra "avisar a equipe no grupo"
  só funciona com Evolution — com as duas conexões, o aviso sai pelo grupo do
  QR mesmo quando o contato falou pela Meta.
- Texto livre obedece à janela de atendimento aberta pelo cliente. Fora dela a
  Meta exige template aprovado; follow-ups e lembretes em texto livre podem ser
  recusados. A tela avisa isso sem fingir paridade que a própria Meta não oferece.
  Para consultas diretas do Clinicorp, Meta usa template aprovado. QR sem
  histórico só pela opção específica da conta, com categoria por ID e
  declaração da clínica (revisão de 09/10 abaixo). Nenhum desses caminhos
  troca o canal conhecido do paciente. Ver
  [ADR-005](../../../docs/decisions/ADR-005-agenda-clinicorp.md).
- Desconectar no fechai é local: não desregistra o telefone do WABA. O webhook
  passa a ignorar a linha e as credenciais ficam preservadas para reconexão.

## Webhook Evolution: por instância, nunca global

O webhook do fechai (`api/webhooks/whatsapp`) **recusa com 401 tudo que não trouxer
o header `x-webhook-secret`** — identificador de instância é identificador, não
credencial. O webhook **global** da Evolution (`WEBHOOK_GLOBAL_*` no compose)
**não sabe mandar header nenhum**: o tipo dela só tem URL, ENABLED e
WEBHOOK_BY_EVENTS; `headers` existe apenas na configuração **por instância**.

Ligar o global, portanto, é o pior dos mundos: o número aparece conectado na
tela e **nenhuma mensagem entra**, porque cada evento toma 401 — e 401 está na
lista de status que a Evolution considera definitivos (`400, 401, 403, 404,
422`), então ela **descarta** em vez de reentregar. Não há fila para recuperar
depois. Foi exatamente esse o sintoma de "0 mensagens recebidas nos últimos 7
dias" com o WhatsApp conectado.

Por isso o compose mantém `WEBHOOK_GLOBAL_ENABLED: "false"` fixo e **quem
configura o webhook é o app**:

- `createInstance()` manda o bloco `webhook` no próprio `/instance/create` —
  instância nasce entregando.
- `ensureWebhook(externalId)` (`POST /webhook/set/{instance}`) reaponta uma
  instância existente. `connectWhatsapp()` a chama a cada conexão (idempotente,
  e **não derruba a conexão se falhar** — o número conectado é o que o cliente
  veio buscar).
- `npm run whatsapp:webhooks` conserta em lote quem já está conectado e não tem
  motivo para clicar em "Conectar" de novo.
- O worker faz a mesma garantia continuamente: a cada minuto lê
  `/webhook/find/{instance}` e só reaplica com `/webhook/set/{instance}` quando
  URL, eventos ou header secreto divergirem. Isso cobre inclusive restart do
  container que preserve a sessão, mas perca a configuração de entrega.

Precisa de `EVOLUTION_WEBHOOK_URL` (a URL pública do `/api/webhooks/whatsapp`) e
`WHATSAPP_WEBHOOK_SECRET` no `.env` do **app**. Sem um dos dois,
`webhookConfig()` devolve `null` e a instância é criada **sem** webhook — o
produto funciona, só não recebe — em vez de entregar sem o header e tomar 401 em
silêncio.

## O QR gira — e a sessão tem contador

Dois detalhes que, juntos, produzem "não foi possível conectar o dispositivo,
tente novamente mais tarde" **no celular**, com a tela do painel mostrando um
código de aparência perfeita:

1. **O WhatsApp troca o QR a cada ~20s** e invalida o anterior na hora. A
   Evolution não devolve a expiração, então `WhatsappConnect.tsx` conta sozinho
   (`QR_TTL_S`) — e, a cada poll, **substitui a imagem** pelo código que veio na
   resposta de `refreshWhatsappStatus()`. Ignorar esse `qrCode` (o que a tela
   fazia) é reexibir um código morto com o contador ainda correndo.
2. **A Evolution corta a sessão em `QRCODE_LIMIT` QRs gerados** (30 por padrão):
   manda `state: "refused"` e passa a recusar toda leitura. O contador só zera
   com um logout de verdade. Por isso `connectWhatsapp()` desloga antes de pedir
   o código — **só quando a instância não está `connected`**, porque deslogar um
   número que está atendendo derruba o atendimento para gerar um QR que ninguém
   pediu. O logout falhando não impede o QR: sessão já limpa devolve erro, e é
   exatamente o estado que queríamos.

## Bloqueio de número: comparar é o problema, não a lista

Guardar uma lista de telefones é fácil; **casar duas escritas do mesmo número**
é onde isso quebra. O dono digita `(11) 98765-4321` na tela e o WhatsApp
entrega `5511987654321` no `remoteJid` — e o mesmo aparelho ainda chega como
`551187654321` quando a origem não traz o nono dígito. Comparar string com
string daria o pior resultado possível: a tela listando "bloqueado" com o
agente respondendo normalmente, e ninguém desconfiando de um bloqueio que a
própria tela confirma.

Por isso tudo passa por `canonicalPhone()`: só dígitos, sem o `55` e **sem o
nono dígito** — DDD + 8 últimos. As três formas colidem de propósito. Número
estrangeiro passa inteiro: sem saber o país não dá para cortar sem risco de
bloquear outra pessoa. É a forma canônica que vai para a coluna
`WhatsappBlockedNumber.phone` (única por tenant), então a consulta do webhook é
um lookup por chave.

O campo da lista preserva todos os dígitos digitados, inclusive quando alguém
cola `+55 11 ...` ou `5511...`. A máscara de telefone do cadastro corta em 11
dígitos e não serve para esta entrada: ela já fez a tela confirmar bloqueios
com o número truncado. Linhas antigas truncadas não podem ser reparadas sem o
dígito perdido; precisam ser removidas e cadastradas outra vez. A lista avisa
quando encontra a forma brasileira truncada mais comum.

Na Evolution, `remoteJid` pode ser um identificador `@lid`, que **não é o
telefone**. O parser usa `remoteJidAlt` e, em mensagem recebida, `senderPn`
quando carregam um JID telefônico. Sem telefone confiável, descarta o evento; extrair os
dígitos do LID faria o bloqueio falhar e ainda criaria um contato incorreto.

Tabela e não coluna Json no Tenant porque isso roda **a cada mensagem que
entra**; e não uma flag no `Lead` porque o caso comum é bloquear quem ainda
**não** escreveu (o ex-fornecedor, o número de spam que já incomodou o
vizinho) — esperar virar lead chegaria sempre tarde.

No webhook a checagem vem **antes** de tudo que custa ou grava: download e
transcrição de áudio, lead, conversa, turno de LLM. Um bloqueado que
continuasse aparecendo em Conversas e queimando cota seria um bloqueio de
mentira. Vale também para `isFromMe` — o dono respondendo à mão num chat
bloqueado não pode ressuscitar a conversa que o bloqueio existe para não ter.
Grupo não passa por aqui: tem dono próprio (`whatsappIgnoreGroups`) e JID de
grupo não é telefone.

As duas saídas automáticas do worker (follow-up e lembretes) também consultam
a lista. Respostas enviadas manualmente por um atendente seguem sob controle
dele em Conversas.

Duas regras que os testes travam:

- **Ignorar é silêncio total.** Nada é respondido — nem um "não posso falar".
  Um aviso automático transformaria o bloqueio num convite a insistir.
- **`isPhoneBlocked` nunca lança e, na dúvida, deixa passar.** Banco fora do ar
  no webhook viraria 500 e a Evolution reentregaria em laço; e engolir a
  mensagem de um cliente real por causa de uma falha de leitura custa a venda,
  enquanto deixar passar um bloqueado é só incômodo.


## Verbos HTTP da Evolution v2

Cada rota tem o seu, e errar o verbo devolve um **404 genérico do Express** que
parece "instância não existe" — foi o que produzia `Evolution logout falhou
(404)` na tela. As que usamos:

| rota | verbo |
| --- | --- |
| `/instance/create` | POST |
| `/instance/connect/{id}` | GET |
| `/instance/logout/{id}` | **DELETE** |
| `/message/sendText/{id}`, `/message/sendWhatsAppAudio/{id}` | POST |
| `/chat/getBase64FromMediaMessage/{id}` | POST |
| `/group/fetchAllGroups/{id}?getParticipants=false` | GET |
| `/webhook/set/{id}` | POST |
| `/instance/connectionState/{id}` | GET |

## Status conectado é uma PERGUNTA, não uma lembrança

`WhatsappInstance.status` era gravado no momento da conexão e nunca mais
revisitado. Quando a sessão morria, ninguém reescrevia o campo: o painel seguia
mostrando "Seu número está atendendo · conectado" por dias, o cliente achava que
estava sendo atendido e os leads caíam no vácuo. Um incidente real só foi
descoberto porque um humano estranhou o silêncio — **horas** depois, com
mensagens perdidas (a Evolution nem chegou a recebê-las: não há o que
reprocessar).

`health.ts` conserta isso em duas frentes, e **as duas são necessárias**:

1. **Estado no provedor** (`getConnectionState`) — pega a sessão derrubada, que
   é o caso comum, e sincroniza o campo do banco.
2. **Silêncio** (`Conversation.lastInboundAt`) — pega o caso que o estado não
   pega. No incidente, a Evolution respondeu `state: "open"` enquanto o
   `logout` da mesma instância, no mesmo segundo, devolvia `"Connection
   Closed"`. **O provedor mente**; o fluxo de mensagens, não. Número
   "conectado" mudo há 6h+ em horário comercial é suspeito até prova em
   contrário.

Três cuidados que o código protege (e os testes travam):

- **`reachable: false` nunca vira alerta.** Evolution fora do ar é problema
  nosso — avisar "seu número caiu" nesse caso é mentir para o cliente e ainda
  provocar uma reconexão desnecessária.
- **Alarme falso corrói o alerta verdadeiro.** Por isso o silêncio só conta em
  horário comercial, com folga de 6h, e há cooldown de 12h por conta
  (`Tenant.whatsappHealthAlertAt`) — sem ele, cada varredura do worker mandaria
  outro e-mail até alguém reconectar.
- **`getConnectionState` nunca gera QR.** `getQrCode` chama
  `/instance/connect`, que **cria um QR a cada chamada** e gasta o
  `QRCODE_LIMIT` (30); usá-lo para monitorar em laço deixaria a instância
  `refused`, recusando a leitura justamente quando alguém fosse religar.

A varredura roda no worker (`workers/follow-up-worker`), junto com follow-up e
lembretes: precisa acontecer mesmo quando **ninguém abre o painel** — o modo de
falha que ela existe para pegar é exatamente o silêncio que ninguém vê.

Com as duas conexões, cada **linha** é checada com o próprio provedor
(`checkTenantWhatsapp(tenantId, now, provider)`), e três regras evitam alarme
falso ou desfazer decisão de gente:

- **O silêncio é sinal só da Evolution.** O "aberto que não recebe" é falha da
  sessão dela; a Cloud API não tem sessão para morrer em silêncio, e a Meta
  costuma servir aos Disparos e passar dias sem receber. E o silêncio do QR é
  medido só entre as conversas que **não** falam pela Meta.
- **Meta desconectada não é religada pelo monitor.** Desconectar é local e o token
  segue válido; perguntar à Meta e sincronizar colocaria de volta no ar o que
  alguém desligou. A Meta só desce para `disconnected` aqui, nunca sobe.
- **Meta de conta sem a liberação do admin não é consultada.**
- **QR desligado pelo admin não é consultado, religado nem avisado.** Ver a seção
  abaixo.

### QR desligado pelo admin (`Tenant.evolutionWhatsappEnabled`)

O superadmin liga/desliga o WhatsApp por QR de cada conta em `/admin/contas`
(`setTenantEvolutionWhatsappEnabled`). Ao contrário da Meta, **nasce ligado**.

- **Só bloqueia: a sessão do aparelho e a linha `WhatsappInstance` ficam como
  estão** (sem logout, sem apagar nada). Reativar volta na hora, sem novo QR. A
  linha segue `connected` no banco, então o bloqueio mora na **leitura**:
  `listWhatsappChannels` e `getWhatsappStatus` excluem a linha Evolution da conta
  desligada (`EVOLUTION_DISABLED_ROW`). Tudo que envia passa por elas, e a regra de
  sempre vale: **sem canal, o envio espera e nunca cai para a Meta**.
- **Entrada:** `processIncomingWhatsapp` devolve 200 `ignored` para a Evolution
  desligada (a sessão ainda entrega eventos; erro faria o provedor reentregar). A
  mensagem recebida nesse intervalo se perde — não há fila.
- **Monitor:** `scanWhatsappHealth` pula a linha, então não religa webhook, não
  sincroniza status, não manda e-mail e não abre `WhatsappIncident`. Ao desligar,
  a queda em aberto do QR é fechada (decisão do admin não é falha de
  disponibilidade do relatório mensal).
- **Cliente:** `connectWhatsapp`, `refreshWhatsappStatus` (gasta `QRCODE_LIMIT`) e
  `setWhatsappAgentReplies("evolution")` recusam; `disconnectWhatsapp` continua
  permitido. Em `/integracoes` só aparece o aviso "Desativado pelo administrador"
  (sem QR nem botão) para quem **já conectou** o QR; quem nunca conectou não vê o
  cartão. Sem Meta e com o QR desligado a tela não mostra os controles do
  atendimento (não há número).
- Ligar `clinicorpQrEnabled` é recusado com o QR desligado; o bloqueio do admin
  vence a exceção das confirmações.

`connectWhatsapp()` também consulta o estado vivo antes de decidir: instância
apagada no provedor (`exists: false`) é **recriada** em vez de receber um pedido
de QR que devolveria 404 — antes, o botão "Conectar" falhava justamente quando
era a única coisa que resolveria.

### Mensagens interativas e a pesquisa de satisfação

`IncomingMessage.replyId` carrega o id da opção escolhida numa lista/botão da Meta
(`interactive.list_reply` / `button_reply`, em `meta-events.ts`); o `text` leva o
título da opção, então o resto do fluxo a trata como mensagem comum. A Meta também
tem `sendRatingPrompt` (lista interativa de até 10 linhas, título ≤ 24 caracteres)
— opcional no contrato, só a Cloud API implementa; no QR (Evolution) não há botões
nem lista e a pergunta vai como texto numerado. Em `process-incoming.ts` o que a
pesquisa envia é reconhecido no ramo `fromMe` (`satisfaction/echo.ts`) para **não
pausar o agente**, e a resposta do contato é capturada antes do turno
(`satisfaction/capture.ts`). Ver `src/modules/satisfaction/README.md`.

## O que NÃO faz

- Não decide a resposta — isso é do `agent-engine` (orquestrador).
- Não persiste conversas/leads — quem grava é o orquestrador.
- `onMessageReceived` é feito via webhook (`api/webhooks/whatsapp`), não por polling.

### Mensagens temporárias na Evolution

O texto e o áudio podem chegar dentro de `ephemeralMessage.message`. O parser
abre esse envelope antes de ler o conteúdo, preservando a chave, o telefone e
`fromMe` do evento original. Não lê mensagens citadas nem transforma eventos de
configuração em conversa; envelopes vazios ou profundos demais são ignorados.
Isso vale também para conversas pausadas: a pausa impede a resposta da IA,
mas não o registro da mensagem recebida. Corrigir o parser não recupera eventos
antigos: a recuperação exige o registro original no provedor, com id e data,
sem recriar uma mensagem a partir de print ou disparar um novo turno de IA.

### Recuperação dos últimos 30 dias

`history-recovery.ts` agenda uma reconciliação da instância inteira, inclusive
contatos ausentes no painel. Só SUPERADMIN personificando uma conta ativa pode
iniciá-la em Integrações; cada leitura/action confere conta e liberação do QR.
`history-recovery-worker.ts` roda na fila independente `whatsapp-history-recovery`:
lotes pequenos, janela congelada de 30 × 24 h, cursor e lease no banco, retomada
após reinício. `evolution-history.ts` consulta `POST /chat/findMessages/{instance}`
com as duas bordas ISO, `page` e `offset`. Nunca requisita reenvio de mensagens.

Somente ids ausentes são inseridos, com `createdAt` original e `recoveredAt`.
Saídas de autoria desconhecida usam `sentBy: history` (nunca IA/humano presumido).
A recuperação não chama o webhook, IA, transcrição, pesquisa, aviso ou envio,
nem altera pausa, prioridade, etapa de follow-up, `lastInboundAt` ou canal já
definido. Conversa nova fica pausada, para revisão humana antes de automatizar.
Contatos novos nascem com a data mais antiga encontrada. Conversas existentes
mantêm seus dados operacionais; só o histórico é completado. Bloqueados, testes,
grupos e mensagens de pesquisa já identificadas ficam fora. Telefone ambíguo não
é unido por palpite. Criação compartilha lock por conta/telefone com a entrada
ao vivo. O banco único de ids de WhatsApp resolve a disputa com o webhook.

O resultado distingue já existentes, recuperadas, fora da janela, sem telefone,
conteúdo não suportado e mídia sem arquivo. Áudio vira `[Áudio]` sem transcrição
fabricada; anexos reconhecidos têm legenda/marcador, sem prometer arquivo salvo.
Mudança de total ou páginas incompletas não vira sucesso. Cada registro da origem
é contado uma vez em `WhatsappHistoryRecoveryItem`; no fim, o total único precisa
fechar com o anunciado pela Evolution. A fonte pode já ter apagado mensagens:
concluir a varredura comprova apenas o que ela ainda conserva, não o WhatsApp todo.
Schema novo exige `db push` + `generate` em web e worker.


## Confirmações QR autorizadas e recibos (09/10/2026)

A exceção de primeiro contato é somente confirmação de consulta do Clinicorp,
com `clinicorpQrEnabled` explícito, categorias por ID e declaração da clínica
salva. Regras e limites em `scheduling/README.md`. Não troca canal Meta → QR,
não inventa entrada do paciente e não inicia follow-up comercial.

Evolution agora assina `MESSAGES_UPDATE`; o monitor `ensureWebhook` repara essa
inscrição. `reminder-receipts.ts` normaliza ACKs; a rota autentica o segredo e
resolve tenant pela instância Evolution. Meta usa assinatura HMAC e phone ID.
`ReminderReceipt` guarda callback antecipado; `ReminderDispatch` só mostra
entregue/lido com recibo. Timeout ou ausência de ID = desconhecido, sem repetição.

### Termos antes de ativar confirmações pela Evolution

A opção específica de confirmações QR exige modal com riscos, checkbox e nome
do responsável. A prova (`clinicorpQrRiskAcceptance`) guarda usuário/data do
servidor e texto/versão; o parser desliga flags sem prova válida. Cancelar não
ativa; reativar pede novo aceite. Não muda as regras de canal e não libera
Disparos/follow-up. Consentimento e deduplicação não eliminam bloqueio: Evolution
por QR não utiliza a API oficial da Meta. API oficial também exige suas políticas.
