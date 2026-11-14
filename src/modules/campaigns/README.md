# Campanhas (`/campanhas`)

Uma campanha reúne uma ação de marketing: o que ela é, de onde vêm os leads,
o que o agente pode ou não fazer com eles e o resultado. Spec: "Aba Campanhas"
(13/11/2026). A visão consolidada por anúncio continua em Relatórios › Campanhas.

## Status (`status.ts`) — calculado na leitura, nunca gravado

`archivedAt` → arquivada · sem `activatedAt` ou sem `startsAt` → **rascunho** ·
antes do início → **agendada** · passou de `endsAt` → terminada · `pausedAt` →
pausada · senão ativa. Datas preenchidas não bastam: nada vale para os leads
até **Ativar** (aba Revisão ou botão do cabeçalho), que exige início e fim.
**Encerrar** traz o fim para agora (única ação de status com confirmação).
`statusWhere` é a mesma regra como filtro de banco, testada contra um avaliador.

## Leads da campanha (`CampaignLead`, `attribution.ts`)

Entram por **anúncio** (o webhook grava `LeadAdOrigin` e `attributeByAd` casa o id
do anúncio ou o código com `CampaignAd`), **disparo** (`recordBroadcastResponse`
→ `attributeByBroadcast`, só disparo com `campaignId`), **palavra-chave** (a
primeira mensagem desde o início contém um termo de `Campaign.keywords`, no
turno do agente) ou **manual** (aba Leads e card do contato em `/conversas`).
Um lead pode estar em várias; a primeira origem fica. Atribuir **nunca lança**.
Só campanha ativada, não arquivada e não terminada recebe lead automático.

## Regras do agente (`rules.ts`, `active.ts`, `slots.ts`, `agent.ts`)

`Campaign.rules` (Json, `parseCampaignRules` nunca lança): datas permitidas,
horários (gerais e por data), **vagas por horário** (evento: várias pessoas no
mesmo horário, sem expediente nem conflito; sem número = agenda normal),
chegada informada, lembretes (`default` | `off` | `custom`), oferta, instruções
extras, comportamento fora da regra (`offer_alternative` | `handoff`) e dias de
extensão depois do fim para quem já agendou.

- **Em vigor** (`findLeadCampaign`): lead na campanha, ativada, não pausada,
  início já chegou, e antes do fim — ou dentro da extensão com consulta
  marcada. Várias em vigor: vale a de atribuição mais recente. O fim não precisa
  de cron: passou da data, a consulta deixa de devolvê-la.
- **Prompt:** `campaignRulesPrompt` entra depois da agenda geral no turno.
- **Backend:** `checkCampaignSlot` em `schedule_meeting`, `reschedule_meeting`,
  `list_available_slots` (só as vagas da campanha) e `createAppointment`
  (lança `CampaignRuleError` para tudo que não é `source: "manual"`; a equipe no
  painel pode marcar fora da regra — é quem atende o lead que não pôde). Falha
  ao ler a campanha **não libera** o horário: a agenda recusa.
- **Lembretes:** `loadReminderOverrides` na varredura. Desligado = não sai e não
  é marcado como enviado (volta a ser avaliado no fim; o que venceu é fechado
  sem envio). Personalizado = os da campanha. O lembrete próprio da consulta
  vence a campanha. Confirmação do Clinicorp não sai para lead de campanha com
  lembretes mexidos. Sem conseguir ler as campanhas, a volta não envia a leads.
- **Transbordo:** com `outside: "handoff"` e sem `handoff_human` ligado no
  agente, o turno ganha `campaign_handoff` (mesmo `transferToHuman`).

## Follow-up, Clinicorp, instruções e prévia (CMP-03)

Tudo em `Campaign.rules`, sem schema novo e sem migração. Linha antiga sem os
campos = comportamento de sempre: follow-up ligado, Clinicorp padrão, sem instruções.

- **Follow-up** (`followUp`, padrão `true`): desligado, o scan do worker pula o
  lead da campanha em vigor (`loadFollowUpOff`) **sem marcar a etapa**; o fim da
  campanha devolve a esteira (etapa velha não sai, `isStale`). Se ler as
  campanhas falhar, só as contas com alguma campanha que pode valer agora ficam
  sem envio nesta volta (`loadTenantsWithCampaign`); se nem isso der para ler, a
  volta não envia nada.
- **Clinicorp** (`clinicorp.mode`: `default` ou `off`): `off` não espelha a
  consulta nova (`skipped`, ao agendar e ao remarcar pelo agente). Não mexe em
  lembrete: a consulta segue a regra de lembretes da campanha e da conta, como
  qualquer consulta só do Fechai. **Remarcar** com `off` também não toca o
  Clinicorp (nem cancela a antiga): se a consulta já estava lá antes da campanha,
  ela fica como está e a recepção ajusta à mão. Escolha de profissional não existe.
- **Vagas** continuam por horário; vaga por dia fica para o CMP-04.
- **Instruções extras** entram no prompt entre marcas, como conteúdo da clínica
  que **não altera datas, horários, vagas nem travas**. Texto que tenta fechar a
  moldura (`FIM DAS INSTRUÇÕES DA CLÍNICA`, `>>>`) é limpo antes. A trava é do servidor.
- **Prévia** (`prompt-preview.ts`): o mesmo `campaignRulesPrompt` do turno, só
  leitura, nos passos "Quem atende" e "Agenda da campanha".
- **Lead de teste** (`linkTestLeadToCampaign`): o botão "Usar o lead de teste
  desta campanha", no passo Agenda, liga o lead do chat de teste da conta à
  campanha (origem manual). Só por clique; o chat de teste precisa ter sido
  aberto ao menos uma vez. Relatórios ignoram `isTest`.

**Configurar:** campanha › "Agenda da campanha" (follow-up automático e consulta
no Clinicorp) e "Quem atende" (instruções extras). Quem salva precisa de
`canEdit`.

**Testar:** `npx vitest run tests/campanha-regras.test.ts tests/campanha-regras-aceite.test.ts tests/campanha-followup.test.ts tests/campanha-entidade-ui.test.ts tests/follow-up-agendamento.test.ts` (Prisma mockado, sem banco).

## Agente da campanha (`agent-routing.ts`)

`Campaign.agentId` atende os leads da campanha **enquanto ela vale** (mesma
regra de `findLeadCampaign`), no lugar do agente da conversa. O caminho
recomendado é a **cópia** (`copyAgentForCampaign`: `buildAgentPackage` +
`createAgentFromPackage`, nasce ligada e não principal), ajustada em
`/agentes/<id>` sem mexer no original (`baseAgentId`). Regras do roteamento:

- o chat de teste não é roteado (lá se escolhe o agente que se quer testar);
- agente desligado, arquivado ou apagado = o lead segue com o de sempre;
- o agente da campanha **não vira dono da conversa** (`Conversation.agentId`
  recebe o original): terminada a campanha, o lead volta sozinho;
- trocar de agente desfaz o vínculo cópia ↔ original.

**Levar o aprendizado** (`mergeCampaignLearning`): os documentos que entraram
na base da cópia depois de `agentCopiedAt` (inclusive as perguntas aprovadas em
`/perguntas`, que viram documento da cópia) aparecem para a pessoa marcar; só o
marcado vai para a base do original, uma vez (`mergedDocIds`). Persona e
regras da campanha nunca voltam sozinhas.

## Tela

Quatro abas: Resultados, Leads, Configuração, Histórico. A Configuração é um
roteiro de passos (`STEPS` em `labels.ts`: o básico, quem atende, agenda, de
onde vêm os leads, arquivos, revisar e ativar), cada um com situação e resumo
de uma linha; rascunho abre nela, no primeiro passo que falta. O guia "Como
funciona" (`CampaignGuide.tsx`) tem o passo a passo com exemplo. Endereços
antigos (`?aba=regras`…) caem no passo certo.

## Anúncios, mídias e disparos

- `CampaignAd`: id do anúncio/conjunto/campanha da Meta e/ou código. Não há
  leitura da conta de anúncios da Meta: a lista "já trouxeram leads" vem de
  `LeadAdOrigin` (o mesmo id/código que atribui o lead). Vincular atribui os
  leads que já vieram dele desde o início.
- `CampaignAsset`: arquivo na CDN (`campanhas/<tenant>/`), limites da Meta,
  uso `agent` | `broadcast` | `both` e instrução. O agente envia com
  `send_campaign_media` (só leads da campanha, uma vez por lead —
  `CampaignLead.sentAssetIds`); sai depois do texto, pelo mesmo número
  (`provider.sendMediaUrl`), e falha de envio não derruba a conversa.
- Disparos: `BroadcastCampaign.campaignId` (no máximo uma campanha). "Novo
  disparo para esta campanha" abre `/disparos/novo?campanha=<id>`.

## Resultados (`results.ts`)

Mesmas regras de Relatórios › Campanhas: `leadOutcome`, `attendanceOf`,
`broadcastFunnel`. Funil por etapa mais avançada (lead → em conversa →
qualificado → agendado → compareceu); **fechamento não é medido** pelo Fechai.
Custo = investimento informado + enviadas × custo por mensagem. Teste fica fora.

## Auditoria e permissão

Toda escrita leva `tenantId` da sessão e grava auditoria (criação, edição,
ativação, pausa, encerramento, regras com antes/depois, vínculos, leads).
`canEdit` (`access.ts`) é o ponto único da permissão até existirem papéis.

Schema novo: `prisma db push` + `prisma generate` nos dois processos (web e
worker). Campanhas criadas antes da ativação existir ficam como rascunho até
alguém ativar.
