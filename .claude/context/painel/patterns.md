# Painel — padrões
```tsx
const [agents, usage] = await getAgentsNavigation(tenantId);
```
- Editor central, navegação por configurações e resumo salvo; teste ocupa o resumo. EditorLayout transforma StepTabs em seções sem desmontar campos.
- SaveBar: dirty/pending; FormSaveBar compartilha snapshotForm com UnsavedForm, incluindo campos ocultos. Falha não avança baseline.
- Conhecimento: editar local → Aplicar ao teste → comparar mesma pergunta/histórico → Publicar. Alterar outra vez invalida o teste no cliente; revisão protege concorrência no servidor.
- Guard ao trocar configuração/sair; ToastProvider para retorno; dialog modal mantém FormFeedback inline.
- Tokens --tenant-* nos dois temas. Grade semanal tem scroll próprio/teclado; mobile não pode ampliar a página.
- cn registra text-micro como tamanho no tailwind-merge.
- Testes novos: sandbox-draft, sandbox-engine-inspection, knowledge-draft-publish. README de Agentes detalha validação e limites.
