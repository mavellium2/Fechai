# Agentes — Telas

| Rota | Componentes e controles |
|---|---|
| `/agentes` | `AgentDirectory` mostra cards, busca local, criação, importação, status real e último agente acessado. |
| `/agentes/[id]` | `AgentWizard` reúne personalidade, regras, dados, conhecimento, agenda, follow-up, transferência, triagem e voz. O resumo lateral mostra configuração salva. |
| `/agentes/[id]`, cabeçalho | `AgentHeader` gerencia nome, agente principal, duplicação, exportação e exclusão conforme as permissões. |
| `/agentes/[id]`, Testar | O sandbox abre no espaço do resumo. Mostra trechos reais enviados ao contexto, instruções da persona e nomes das ferramentas chamadas. |
| `/agentes/[id]`, Conhecimento | Abre o [editor de documentos e rascunho de teste](../base-de-conhecimento/telas.md). |

A edição é central no desktop. No mobile, os grupos rolam horizontalmente e o teste abre sobre o editor. Toggles de habilidade e comportamento têm salvamento imediato.

[Mapa da interface](../../../src/app/(dashboard)/agentes/README.md)

**Transferência** (`HandoffSettings`): "Enquanto aguarda alguém da equipe, a IA" escolhe entre continuar respondendo (padrão) e pausar até alguém usar Reativar agente em Conversas. O aviso ao grupo fica abaixo, com o exemplo do que a equipe recebe. Com só a Meta conectada, a tela explica que o grupo exige o QR e que o transbordo continua no Fechai.
