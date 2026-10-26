# Painel — ações
Nenhuma server action nova. Fonte reutilizada: `src/app/(dashboard)/agentes/actions.ts`.
`Result={ok:boolean,error?,info?}`; `AgentCopyResult` acrescenta agentId?/warnings?.

- `createAgentAction(prev,FormData)`: nome via Zod e limite; cria, revalida e redireciona.
- `importAgentAction(prev,FormData)` / `duplicateAgent(id)`: pacote e limite; AgentCopyResult.
- `renameAgent(id,name)`: nome 1–60; Result.
- `setPrimaryAgent(id)` / `setAgentEnabled(id,bool)`: Result.
- `deleteAgent(id)`: exclusão real; exige outro ativo e preserva conversas por substituição.
- `setActionEnabled(id,key,bool)`: catálogo e limite do plano; Result.
- `setAgentBehavior(id,field,bool)`: áudio exige voz e disponibilidade; Result.
- Editores mantêm actions de persona, regras, dados, conhecimento, agenda, follow-up e voz.

Criação/importação exigem tenant; demais operações por id passam por requireAgent/posse. As actions mantêm auditoria e revalidação. Tema/menu só alteram preferências locais.
