# Página Disparos

Documentação completa de acesso, arquivos de importação, templates, fila,
estados, deploy e testes em
[`src/modules/broadcasts/README.md`](../../../modules/broadcasts/README.md).

- `layout.tsx` e `page.tsx`: guarda de acesso e estado da conexão.
- `DisparosClient.tsx`: importação, associação de colunas e atualização periódica.
- `BroadcastReview.tsx`: revisão, teste explícito, faixa/data/fuso, consentimento
  e aviso de contatos recentes.
- `BroadcastHistory.tsx`: busca, filtros, paginação, pausa/retomada, CSV, saúde e
  resultados. `RecipientTable.tsx` separa execução de entrega e identifica testes.
  Os formulários usam os componentes do painel e `SelectMenu`.
- `actions.ts`: autorização repetida em cada chamada, importação validada no
  servidor, confirmação idempotente, consultas isoladas por tenant e modelos
  Excel/JSON para download, testes idempotentes, pausa/retomada e exportação.
