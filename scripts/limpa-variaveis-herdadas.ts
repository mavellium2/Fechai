/**
 * Apaga de `Conversation.variables` os valores que o sistema preencheu sozinho
 * antes de as variáveis passarem a nascer "não informado" (ver
 * `withContactDefaults()` em src/modules/agent-engine/variables.ts).
 *
 * Remove só o que é inequivocamente herdado:
 *
 * - {{numero}} do sandbox ("sandbox" / "sandbox:<agentId>"), que nunca foi um
 *   telefone — era o que a tela mostrava como "Número de telefone do contato".
 * - {{nome}} das conversas de TESTE, onde o valor é o rótulo do chat de teste
 *   ("Chat de teste"), não algo que alguém tenha dito.
 *
 * O {{numero}} de conversa real fica: é a identidade do contato e
 * `withContactDefaults()` o repõe na leitura de qualquer forma.
 *
 * O {{nome}} de conversa REAL também fica, de propósito. Não existe no banco a
 * origem do nome: `remember_variables` grava o nome dito pelo contato e
 * atualiza `Lead.name` junto, então um {{nome}} igual ao `Lead.name` pode ser
 * tanto o apelido do perfil do WhatsApp quanto o nome que a pessoa informou —
 * apagar os dois perderia dado real de conversa em andamento. Nas conversas
 * novas o problema não existe, porque o nome do perfil não é mais copiado para
 * as variáveis.
 *
 * Rode uma vez:
 *   npx tsx scripts/limpa-variaveis-herdadas.ts
 *
 * Idempotente: rodar de novo não muda nada.
 */
import { prisma } from "../src/lib/prisma";
import { isSyntheticPhone } from "../src/lib/format";
import { parseConversationVariables } from "../src/modules/agent-engine/variables";

async function main() {
  // Sem filtro por `variables`: em Json nulo o Prisma exige `JsonNull`, e as
  // conversas sem variável nenhuma já saem baratas pelo `continue` do loop.
  const conversations = await prisma.conversation.findMany({
    select: {
      id: true,
      isTest: true,
      variables: true,
      lead: { select: { name: true, phone: true } },
    },
  });

  let limpas = 0;
  for (const conversation of conversations) {
    const values = parseConversationVariables(conversation.variables);
    const next = { ...values };

    if (values.numero && isSyntheticPhone(values.numero)) delete next.numero;

    const ehTeste = conversation.isTest || isSyntheticPhone(conversation.lead.phone);
    if (ehTeste && values.nome && values.nome === conversation.lead.name?.trim()) delete next.nome;

    if (Object.keys(next).length === Object.keys(values).length) continue;
    await prisma.conversation.update({ where: { id: conversation.id }, data: { variables: next } });
    limpas += 1;
  }

  console.log(`conversas analisadas: ${conversations.length}`);
  console.log(`conversas com variáveis herdadas removidas: ${limpas}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
