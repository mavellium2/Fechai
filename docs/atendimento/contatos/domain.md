# Contatos — Domínio

- `Lead` representa o contato. `Conversation` guarda histórico, resumo e canal de resposta.
- Nome e variáveis editados pela equipe valem e ficam travados; o nome do perfil do WhatsApp (`Lead.whatsappName`) e o telefone ficam como original. A regra completa está no [domínio do CRM](../../painel/crm/domain.md) e em `src/modules/crm/contact-profile.ts`.
- Os rótulos de estado da lista vêm de `Lead.status` (`new`, `warm`, `hot`, `scheduled`, `lost`). As etapas comerciais do CRM usam `Lead.stageId`.
