# Ambientes, deploy e backup

Ponto de entrada para desenvolvimento local, validação com banco isolado e operação do Fechai.

## Desenvolvimento local

```bash
cp .env.example .env
npm install
npm run db:up
npm run db:push
npm run db:seed
npm run dev
```

O painel local usa a porta `3001`. Veja as variáveis em [`.env.example`](../../../.env.example) e os scripts no [README do projeto](../../../README.md).

## Laboratório administrativo

`npm run test:db:prepare` prepara o banco isolado e `npm run dev:test` abre o laboratório na porta `3002`. [Configuração, VPS e travas](ambiente-de-testes-admin.md)

## Produção e worker

- Deploy e serviços Docker. [Guia de produção](../../../README.docker.md)
- Fila de follow-up, lembretes e demais tarefas periódicas. [Worker](../../../workers/follow-up-worker/README.md)
- Backup e restauração do banco. [Serviço de backup](../../../deploy/BACKUP_SERVICE.md)

O web e o worker usam o mesmo schema Prisma. Mudança de schema requer aplicar `db push` na base do ambiente e disponibilizar o client gerado por `prisma generate` para os dois processos. O fluxo de deploy está no guia de produção.
