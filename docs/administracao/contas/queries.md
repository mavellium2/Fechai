# Gestão de contas — Consultas

- `listTenants(filters)` e `countHiddenTenants()` alimentam a lista e o aviso de contas omitidas. `getTenantDetail` carrega usuários e contagens.
- `tenant-export.ts` percorre os dados em lotes e termina com contagens e `completed: true` quando concluído.
- A exportação inclui `pipelines`, `pipelineStages`, `leadTransitions`, `tags`, `leadTags`, `leadTasks` e `conversationAssignments` da conta, além de `Lead.stageId` e `Lead.originChannel`. O campo interno `crmActivationToken` fica fora do JSON.
