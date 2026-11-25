# Documentação do Fechai

A documentação acompanha as funcionalidades do painel. Abra o `_index.md` da área que você quer entender e siga os links para regras de negócio, telas, consultas, ações, padrões e histórico.

## Painel do cliente

| Funcionalidade | Rota | Guia |
| --- | --- | --- |
| Início | `/inicio` | [Visão inicial e configuração](painel/inicio/_index.md) |
| Conversas | `/conversas` | [Caixa de entrada e atendimento humano](atendimento/conversas/_index.md) |
| Agenda | `/agenda` | [Agendamentos e lembretes](operacao/agenda/_index.md) |
| Perguntas | `/perguntas` | [Perguntas sem resposta](atendimento/perguntas-sem-resposta/_index.md) |
| Contatos | `/contatos` | [Cadastro e mensagens manuais](atendimento/contatos/_index.md) |
| Agentes | `/agentes` | [Configuração, habilidades e teste](atendimento/agentes/_index.md) · [Base de conhecimento](atendimento/base-de-conhecimento/_index.md) |
| CRM | `/crm` | [Funil comercial e ativação](painel/crm/_index.md) |
| Disparos | `/disparos` | [Modelos da Meta, importação, envio e entrega](resultados/disparos/_index.md) |
| Afiliado | `/afiliado` | [Indicações e comissões](plataforma/afiliados/_index.md) |
| Campanhas | `/campanhas` | [Campanhas e atribuição de tráfego](resultados/campanhas/_index.md) |
| Relatórios | `/relatorios` | [Operacional e financeiro](resultados/relatorios/_index.md) · [Relatório mensal](resultados/relatorio-mensal/_index.md) · [Qualidade dos leads](resultados/qualidade-dos-leads/_index.md) · [Satisfação](atendimento/satisfacao/_index.md) |
| Integrações | `/integracoes` | [WhatsApp](operacao/whatsapp/_index.md) · [Calendários](operacao/calendarios/_index.md) · [Bitrix24](operacao/bitrix24/_index.md) · [Widget](operacao/widget/_index.md) |
| Configurações | `/configuracoes` | [Perfil, papéis, senha e área de atendimento](plataforma/configuracoes/_index.md) |

## Administração

| Funcionalidade | Rota | Guia |
| --- | --- | --- |
| Contas | `/admin/contas` | [Gestão de contas e exportação](administracao/contas/_index.md) |
| Relatórios | `/admin/relatorios` | [Fechamento e entrega do relatório mensal](resultados/relatorio-mensal/_index.md) |
| Perguntas | `/admin/perguntas` | [Fila, revisão e privacidade](atendimento/perguntas-sem-resposta/_index.md) |
| Agentes | `/admin/agentes` | [Agentes no admin, MCP e propostas](administracao/agentes-mcp/_index.md) |
| Logs | `/admin/logs` | [Auditoria, reversão e bloqueio de IP](administracao/logs/_index.md) |
| IA | `/admin/ia` | [Provedores, modelos e credenciais](administracao/ia/_index.md) |

## Plataforma

- [Autenticação e sessão](plataforma/autenticacao/_index.md)
- [Cadastro e onboarding](plataforma/contas/_index.md)
- [Planos e cobrança](plataforma/cobranca/_index.md)
- [Interface, tema e notificações](plataforma/interface/_index.md)
- [Ambiente local, laboratório, deploy e backup](plataforma/ambientes/_index.md)
- [Site público e SEO](plataforma/site-publico/_index.md)

## Referências do projeto

- [Arquitetura](../ARCHITECTURE.md) e [convenções de código](../CONVENTIONS.md)
- [Histórico de entregas](projeto/CHANGELOG.md)
- [Decisões técnicas](decisions/), [planos de trabalho](plans/) e [relatos de incidentes](incidentes/)

## Como manter

- Documente cada funcionalidade na pasta dela. Use `_index.md` como mapa de entrada e `domain.md`, `telas.md`, `queries.md`, `actions.md`, `patterns.md` e `changelog.md` para os detalhes.
- Assuntos transversais podem usar só `_index.md` e guias específicos. Estudos, diagnósticos e contratos ficam na pasta da funcionalidade e são identificados no índice.
- Confira as regras no código e aponte para os contratos técnicos existentes. Registre mudanças no histórico da funcionalidade com a mais recente primeiro. [Guia de manutenção](../.claude/skills/docs/SKILL.md)
