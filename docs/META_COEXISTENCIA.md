# Conectar o WhatsApp Business pelo Fechai

Implementação do **Cadastro Incorporado (Embedded Signup v4)** para manter o
WhatsApp Business no celular e conectar o mesmo número à Cloud API. O app
pertence à Mavellium; a conta de mensagens e o número continuam na empresa
cliente. Não criar outro app para cada clínica.

## Preparação do app parceiro (uma vez)

1. Entre em [Meus aplicativos](https://developers.facebook.com/apps/) com o
   **perfil do Facebook que administra o app da Mavellium** e abra o app existente.
   Para o app usado neste atendimento:
   [Fechai – Instituto do Sorriso](https://developers.facebook.com/apps/1630558868447132/).
2. Em **Connect on WhatsApp → Become a Partner → Become Tech Provider**, prepare
   a habilitação de Provedor de Tecnologia. A operação para clientes exige a
   habilitação e o acesso avançado aplicáveis. A documentação permite testar
   o Cadastro Incorporado com usuários administradores ou desenvolvedores do
   app antes da análise; isso não comprova que toda conta cliente estará elegível.
   Se a configuração estiver bloqueada, confira o requisito exibido pela Meta.
3. Em **Login do Facebook para Empresas → Configurações**, use **Criar a partir
   de modelo → WhatsApp Embedded Signup Configuration With 60-day Expiration
   Token**. Selecione somente os ativos necessários e confira
   `whatsapp_business_management` e `whatsapp_business_messaging`.
   Copie o **ID da configuração**. Ele não é o ID do app nem o ID da WABA.
   Neste atendimento, o usuário criou a configuração **4289126281379199** para
   o app **1630558868447132**. O ID foi salvo no `.env` local; isso não configura
   o servidor de produção nem confirma a conclusão da conexão do Instituto.
4. Em **Login do Facebook para Empresas → Settings**, habilite OAuth do cliente,
   OAuth da web, HTTPS, navegador incorporado, modo estrito e SDK JavaScript.
   Cadastre o domínio HTTPS que serve o Fechai nos domínios permitidos para o
   SDK e a URL da página em **URIs de redirecionamento OAuth válidos**.
   Nesta instalação: domínio `https://fechai.januscms.com.br` e página
   `https://fechai.januscms.com.br/integracoes`.
5. Em **Configurações do app → Básico**, copie o **App ID** e o **App Secret**.
   Configure no `.env` do servidor, sem enviar segredos por chat:

   ```dotenv
   META_APP_ID="ID_DO_APP_PARCEIRO"
   META_APP_SECRET="SEGREDO_DO_MESMO_APP"
   META_EMBEDDED_SIGNUP_CONFIG_ID="ID_DA_CONFIGURACAO_DO_PASSO_3"
   META_WEBHOOK_VERIFY_TOKEN="SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES"
   META_GRAPH_API_VERSION="v26.0"
   NEXTAUTH_URL="https://fechai.januscms.com.br"
   ```

   `ENCRYPTION_KEY` e Redis já usados pelo Fechai também são obrigatórios.
   Preserve a `ENCRYPTION_KEY` existente: trocar a chave torna as credenciais
   anteriores ilegíveis. As quatro variáveis `META_*` de configuração são
   **do servidor**, não usam prefixo `NEXT_PUBLIC_`.
6. Faça o deploy do código e atualize o banco e o cliente Prisma na **web e no
   worker** (`db push` + `generate`, conforme o procedimento do projeto).
   O schema acrescenta apenas `WhatsappInstance.metaCoexistenceSync`, JSON
   opcional para registrar solicitações únicas de sincronização. Nenhuma
   conexão é convertida por alteração de schema. Reinicie os dois processos.
7. Em **WhatsApp → Configuration** do app da Meta, configure:

   - Callback URL: `https://fechai.januscms.com.br/api/webhooks/whatsapp/meta`
   - Verify token: exatamente o valor de `META_WEBHOOK_VERIFY_TOKEN`.
   - Assine `messages`, `account_update`, `history`, `smb_app_state_sync` e
     `smb_message_echoes`.

   O callback compartilhado substitui o callback padrão específico de uma
   clínica. Cada evento continua isolado pela WABA, Phone Number ID e App
   Secret salvo na conta. A conclusão também configura as substituições de
   callback na WABA e no telefone; `account_update` sempre usa o callback
   padrão do app. Conexões manuais antigas mantêm sua rota por tenant.

## A clínica conecta (computador + celular)

1. No computador, abra [Integrações do Fechai](https://fechai.januscms.com.br/integracoes).
   A Meta deve estar liberada pelo administrador para essa conta.
2. No cartão **API oficial da Meta**, clique **Conectar com a Meta**, ou
   **Refazer conexão pela Meta** quando já houver credenciais.
3. Na janela oficial, entre com acesso à empresa da clínica e escolha conectar
   **seu aplicativo WhatsApp Business existente**. Confira o número.
4. No celular **desse número**, abra o WhatsApp Business e a mensagem oficial
   do Facebook/Meta, toque em **Conectar → Conectar à Plataforma do WhatsApp
   Business → Confirmar** e informe o código ou leia o QR exibido pelo fluxo
   oficial. O Fechai não importa o histórico antigo: prefira não compartilhá-lo.
5. Conclua a janela da Meta e mantenha o aplicativo do celular aberto enquanto
   a Meta prepara a conexão. O Fechai verifica a autorização, a WABA e o número,
   configura o recebimento e solicita a sincronização inicial exigida pela Meta.
   Se a Meta ainda não confirmou a conexão, use **Concluir conexão** novamente;
   para trocar a seleção ou reiniciar uma autorização expirada, **Recomeçar**.

O número **não é removido do aplicativo**, e este fluxo não chama `/register`
nem `/deregister`. O estado aceito é `platform_type=CLOUD_API`,
`is_on_biz_app=true`, `status=CONNECTED`. Ler um perfil com HTTP 200 não basta.
Uma conexão que já tem WABA/número só pode reautorizar os mesmos ativos por
este botão; trocar credenciais é uma ação separada. O número da Evolution
deve ser diferente do número integrado por coexistência.

Para o Instituto deste atendimento, conferir na seleção: empresa **Calebe
Giunco Junior**, conta **Thalita – Instituto do Sorriso**, número terminado em
**8500**. Esses dados não são fixados no código.

## Segurança e retomada

- A tentativa expira em 15 minutos e é vinculada ao usuário, tenant e
  configuração do app. Origem HTTPS e sessão são conferidas em todo POST.
  Código OAuth é de uso único e é trocado imediatamente no servidor.
- App Secret e access token nunca vão ao navegador. O token pendente fica
  cifrado no Redis, com expiração; o definitivo fica cifrado no banco.
  O token de verificação do callback compartilhado não é mostrado à clínica.
- As três etapas conferem produto, conta ativa e liberação Meta. A conclusão
  revalida a liberação antes de gravar e antes de ativar. Locks distribuídos e
  transação serializável protegem concorrência; outra conta não pode vincular
  a mesma WABA/número por esse fluxo. A Evolution não é modificada.
- Sincronização de contatos e histórico é solicitada uma vez. A coluna JSON
  guarda o estado e o `request_id` de cada pedido, sem conteúdo pessoal. Se
  houver timeout ou falha de persistência depois da chamada, fica `unknown`:
  **não reenviar automaticamente**. A equipe precisa conferir os retornos com
  a Meta antes de mexer nesse registro. Não apagar o JSON para forçar retry.
- O Fechai reconhece os webhooks de histórico/contatos sem importar seu
  conteúdo. Eles nunca entram no agente, nas campanhas ou nos relatórios.
  Não existe promessa de importação do histórico neste recurso.
- `smb_message_echoes` entra como resposta humana pelo canal Meta, com o mesmo
  mecanismo de deduplicação e pausa do agente usado para mensagens da equipe.
  Não conta como resposta do lead a uma campanha.
- `PARTNER_REMOVED`/`ACCOUNT_OFFBOARDED` desconectam localmente a linha Meta;
  preservam credenciais e a Evolution. Um evento de reconexão não a religa
  automaticamente. A remoção confirmada marca a geração anterior dos pedidos
  de sincronização; em um novo onboarding os IDs anteriores são preservados
  e a nova integração pode solicitar seus próprios dados uma vez. Desconectar
  apenas no Fechai não limpa esse controle. O monitor confirma a conexão
  consultando plataforma/status.
- A conclusão não cria templates, não envia mensagens e não garante que a
  Meta liberou a criação de modelos. Depois dela, tentar novamente a criação
  em **Disparos → Modelos**; se a recusa continuar, preservar o erro para suporte.

## Referências oficiais conferidas em 17/10/2026

- [Implementação do Cadastro Incorporado v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
- [Coexistência com WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Conclusão pelo Provedor de Tecnologia](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/)
- [Substituições de callback por WABA e número](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/)
