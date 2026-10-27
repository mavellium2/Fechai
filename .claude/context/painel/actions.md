# Painel — ações
Fonte: `(dashboard)/agentes/actions.ts`; Result={ok,error?,info?}.
- Criar/importar/duplicar: validação e limite do plano; gestão no AgentHeader.
- Renomear/principal/ligar/excluir: requireAgent/posse, auditoria e revalidação existentes.
- setActionEnabled: catálogo e limite; setAgentBehavior: voz exige configuração.
- Editores mantêm actions de persona, regras, dados, agenda, follow-up e voz.
- getDocumentContent: texto/título/revisão SHA-256 sob demanda.
- updateDocumentAction com baseRevision: verifica revisão; publishDocumentDraft prepara embeddings e substitui documento/chunks/vetores em transação condicional. Conflito/falha não muda o publicado.
- POST /api/sandbox: sessão UUID, rascunho opcional, comparação com histórico anterior; valida posse e limites. Teste sem WhatsApp/cota/agenda real. DELETE arquiva só a sessão informada.
- Conversas mantém actions de envio/pausa/reativação/resumo. Assumir usa pausa existente.
Tema/menu alteram apenas preferências locais.
