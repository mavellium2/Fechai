# Provedores e modelos de IA

Administra a cadeia de modelos, credenciais e diagnóstico de uso das chamadas de IA.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/admin/ia` |
| Acesso | Superadmin na interface de administração. |
| Código | [Módulo ai](../../../src/modules/ai), [tela](../../../src/app/(admin)/admin/ia) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- Os consumidores chamam os contratos do módulo. Cada adaptador traduz erros e chamadas de ferramentas do provedor.
- Os embeddings usados na base de conhecimento têm 1.536 dimensões.

## Referências

- [Guia técnico](../../../src/modules/ai/README.md)
- [Agentes](../../atendimento/agentes/_index.md)
- [Base de conhecimento](../../atendimento/base-de-conhecimento/_index.md)
