# Gestão de campanhas

`/campanhas` lista as campanhas da conta e `/campanhas/[id]` mostra o resumo.
Anúncios, regras do agente, mídias, disparos, leads e resultados têm espaço no
detalhe para os próximos cards. A visão consolidada fica em Relatórios › Campanhas.

- `access.ts` obtém a conta e o usuário da sessão. Páginas e actions repetem
  a checagem de acesso ao produto. `canEdit` concentra a permissão até a SEG-05.
- `period.ts` converte dias do formulário para UTC no fuso salvo na campanha.
  O fuso inicial é `America/Sao_Paulo` e o dia de término é inclusivo.
- `status.ts` calcula rascunho, ativa, pausada, terminada e arquivada na leitura.
  O mesmo critério filtra no banco. O fim do período prevalece sobre a pausa.
- As actions gravam pelo `id` e pelo `tenantId` da sessão. As condições de
  escrita conferem o estado lido antes da mutação. Mover o início para o futuro
  ou removê-lo limpa a pausa. Campanha terminada só permite arquivar. Desarquivar
  devolve a campanha ao estado indicado pelas datas.
- A auditoria registra criação, edição e transições de status. O desfazer do
  admin só restaura campos da edição, na conta do evento, e recusa campanha
  arquivada, terminada ou período invertido.

Para testar com o banco do ambiente, aplique `prisma db push` e rode
`prisma generate` no web e no worker. Os testes `campanha-entidade-*.test.ts`
rodam com mocks e cobrem status, datas, isolamento, mutações e auditoria.
