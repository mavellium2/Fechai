# Ambiente de testes do administrador

O laboratório usa um banco PostgreSQL separado. Ele nunca alterna a conexão de
uma aplicação de produção já aberta.

## Primeira preparação

1. Opcionalmente configure `TEST_DATABASE_URL` no `.env`. Sem ela, o sistema
   deriva uma base irmã de `DATABASE_URL` acrescentando `_test` ao nome. Em
   ambos os casos, o nome precisa conter `test`, `teste`, `sandbox` ou `lab`.
2. Suba o PostgreSQL com `npm run db:up`.
3. Execute `npm run test:db:prepare` para criar a base, aplicar o schema e
   inserir as contas de demonstração.
4. Inicie o laboratório com `npm run dev:test` e abra
   `http://localhost:3002`.

O ambiente normal continua em `http://localhost:3001` e usa `DATABASE_URL`.

`saas_test` é outro **banco lógico** dentro do PostgreSQL local já existente;
não é necessário criar outro container para obter isolamento dos dados. O app
de laboratório usa a outra URL e, por isso, não lê nem grava no banco `saas`.

## Commit, push e produção

Commit e push enviam apenas os arquivos versionados. Eles não enviam o conteúdo
do `saas_test` e o deploy automático não cria um segundo Postgres na VPS. No
push para `main`, o GitHub Actions atualiza somente os containers do app web e
do worker; o Postgres de produção e seu volume são preservados.

Para disponibilizar um laboratório online, crie deliberadamente uma implantação
separada, com outro domínio/porta e uma `DATABASE_URL` exclusiva. Defina também
`DATABASE_ENVIRONMENT=test`. Não aponte uma instância de laboratório para o
banco de produção e não exponha a base local pela internet.

## Laboratório na VPS

O repositório inclui `docker-compose.test.yml` e `deploy-test.sh`. Eles criam o
projeto Compose `fechai-test`, com três serviços isolados:

- `postgres`: banco fixo `saas_test`, usuário próprio e volume `test_pgdata`;
- `redis`: cache/fila próprios, com volume `test_redisdata`;
- `web`: app em `DATABASE_ENVIRONMENT=test`, publicado pelo Traefik.

Não há worker nem Evolution nessa stack. Assim, follow-ups e mensagens reais de
WhatsApp não saem do laboratório por acidente. Todas as integrações usam
variáveis `TEST_*` e ficam indisponíveis enquanto estiverem vazias.

### Primeira subida

1. Crie um registro DNS A, por exemplo `teste.fechai.januscms.com.br`, apontando
   para a VPS.
2. Na VPS, dentro de `/var/www/Fechai`, copie o modelo sem versionar o segredo:

   ```bash
   cp deploy/test.env.example .env.test-vps
   nano .env.test-vps
   ```

3. Preencha pelo menos `TEST_APP_DOMAIN`, `TEST_POSTGRES_PASSWORD` e
   `TEST_AUTH_SECRET`. Gere uma senha hexadecimal para o Postgres, pois ela entra
   numa URL. Preencha também `TEST_BASIC_AUTH`, que protege todo o subdomínio
   antes mesmo da tela de login:

   ```bash
   docker run --rm httpd:2.4-alpine htpasswd -nbB admin 'SENHA-FORTE' | sed 's/\$/\$\$/g'
   ```

   Cole o resultado inteiro após `TEST_BASIC_AUTH=`. O deploy é recusado se
   essa segunda barreira não estiver configurada, pois o seed possui contas com
   senha pública de demonstração.
4. Depois que o commit estiver em `main`, abra GitHub → Actions → **Deploy
   Laboratório** → **Run workflow**. Também é possível executar na VPS:

   ```bash
   chmod +x deploy-test.sh
   ./deploy-test.sh
   ```

O script sobe a infraestrutura, constrói a imagem, aplica o schema somente no
`saas_test`, executa o seed idempotente e só então publica o app. Novas execuções
preservam o volume do laboratório. Para inspecionar o Postgres por túnel SSH,
use a porta local da VPS `5434` (configurável por
`TEST_POSTGRES_HOST_PORT`).

### Remoção

Parar o laboratório preservando dados:

```bash
docker compose --project-name fechai-test --env-file .env.test-vps -f docker-compose.test.yml down
```

Não acrescente `-v` a menos que queira apagar definitivamente o banco de teste.

## Travas

- O comando recusa `TEST_DATABASE_URL` igual a `DATABASE_URL`.
- O nome da base precisa indicar explicitamente que é teste/laboratório.
- O painel mostra uma faixa amarela enquanto usa o banco isolado.
- Na VPS, use exclusivamente `docker-compose.test.yml`/`deploy-test.sh`; não
  acrescente o laboratório ao compose de produção.

## Comandos

- `npm run test:db:prepare`: cria, atualiza e semeia o banco.
- `npm run test:db:push`: atualiza apenas o schema.
- `npm run test:db:seed`: recria somente os dados de demonstração idempotentes.
- `npm run test:db:studio`: abre o Prisma Studio conectado ao laboratório.
- `npm run dev:test`: inicia o aplicativo na porta 3002 com a base isolada.
