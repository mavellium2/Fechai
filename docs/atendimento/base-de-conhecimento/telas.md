# Base de conhecimento — Telas

## `/agentes/[id]` › Conhecimento

- `KnowledgeManager` permite colar um texto ou selecionar vários arquivos `.txt`, `.md` e `.pdf`. A lista exibe título e estado e permite abrir, baixar o original disponível ou excluir.
- `KnowledgeWorkspace` carrega título, texto e revisão quando o documento é aberto. A edição gera rascunho local, protegido pelo aviso de alterações não salvas.
- **Aplicar ao teste** repete a última pergunta com seu histórico anterior, até dez mensagens. O sandbox mostra fontes do contexto e habilita a publicação daquela revisão após o teste.
- Ao editar novamente é preciso testar a revisão atual para publicar pelo workspace. Recarregar ou descartar remove o rascunho local.

[Workspace](../../../src/app/(dashboard)/agentes/KnowledgeWorkspace.tsx) · [Mapa da interface](../../../src/app/(dashboard)/agentes/README.md)
