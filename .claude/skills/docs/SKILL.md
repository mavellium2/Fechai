---
name: module-docs
description: Cria e atualiza documentação técnica do Fechai por funcionalidade em docs/. Use para manter regras, telas, consultas, ações, padrões e histórico.
---

# Documentação por funcionalidade

A entrada é `docs/README.md`, com os guias na ordem dos menus do cliente e do admin. Cada funcionalidade ganha um diretório na área correspondente. Reutilize o diretório quando a funcionalidade aparecer em mais de um menu ou rota. Temas transversais podem ter apenas um `_index.md` e os guias necessários.

## Arquivos da funcionalidade

| Arquivo | Conteúdo |
| --- | --- |
| `_index.md` | Escopo, rota, acesso, arquivos-chave, links para detalhes e regras de manutenção. |
| `domain.md` | Modelos, relações, invariantes, cálculos e estados. |
| `telas.md` | Rotas, componentes, filtros, formulários e estados visíveis. |
| `queries.md` | Funções de leitura, escopo da conta, filtros, ordenação e paginação. |
| `actions.md` | Mutações, argumentos relevantes, validação, autorização e efeitos. |
| `patterns.md` | Padrões e exemplos confirmados no código com caminho de origem. |
| `changelog.md` | Mudanças com data, motivo e efeito, da mais recente para a mais antiga. |

## Fluxo

1. Localize a área pelo índice e leia o guia e as instruções correspondentes em `AGENTS.md`.
2. Confira as rotas em `src/app/`, as regras e os serviços em `src/modules/` e os modelos em `prisma/schema.prisma`. Confira worker e testes quando fizerem parte do fluxo.
3. Descreva os contratos e as exceções com os nomes reais do código. Aponte para os READMEs técnicos existentes quando detalharem o assunto.
4. Coloque estudos, diagnósticos e contratos complementares na pasta da área e liste-os no `_index.md`. Identifique planos e registros históricos como tais.
5. Se mover um documento, atualize os caminhos relativos e as referências ao arquivo. Inclua guias novos no índice principal e registre as mudanças no histórico da funcionalidade.
6. Mantenha credenciais, dados reais de clientes e conteúdo sensível fora dos guias.
