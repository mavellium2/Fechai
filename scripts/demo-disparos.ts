/**
 * Contatos de exemplo para testar os Disparos no computador (com a Meta
 * simulada, ver `src/modules/broadcasts/simulation.ts`).
 *
 *   npx tsx --env-file=.env scripts/demo-disparos.ts
 *
 * Só roda contra banco local (localhost/127.0.0.1). Cria 30 contatos em cada
 * conta liberada para Disparos que ainda não tem contato de exemplo, bloqueia
 * dois deles e marca um como "pediu para parar". Telefones na faixa 5511900000xxx.
 */
import { PrismaClient } from "@prisma/client";
import { canonicalPhone } from "../src/modules/whatsapp/blocklist";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error("Recusado: este script só roda contra banco local.");
  process.exit(1);
}

const NAMES = [
  "Ana Souza", "Bruno Lima", "Carla Mendes", "Diego Alves", "Elisa Rocha",
  "Fábio Nunes", "Gabriela Dias", "Henrique Costa", null, "Isabela Martins",
  "João Pedro", "Karina Freitas", "Lucas Ribeiro", null, "Mariana Gomes",
  "Natália Pires", "Otávio Ramos", "Paula Cardoso", "Rafael Teixeira", null,
  "Sabrina Lopes", "Thiago Moreira", "Ursula Campos", "Vinícius Barros", "Wesley Duarte",
  "Yasmin Castro", "Zé Carlos", "Bianca Araújo", "Caio Monteiro", "Daniela Reis",
];
const STATUSES = ["new", "warm", "hot", "scheduled", "lost"];

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: { metaWhatsappEnabled: true },
    select: { id: true, name: true },
  });
  for (const tenant of tenants) {
    const exists = await prisma.lead.count({
      where: { tenantId: tenant.id, phone: { startsWith: "5511900000" } },
    });
    if (exists) {
      console.log(`• ${tenant.name}: já tem contatos de exemplo.`);
      continue;
    }
    for (const [i, name] of NAMES.entries()) {
      const phone = `5511900000${String(100 + i)}`;
      const lead = await prisma.lead.create({
        data: { tenantId: tenant.id, phone, name, status: STATUSES[i % STATUSES.length] },
      });
      if (i === 5)
        await prisma.conversation.create({
          data: { tenantId: tenant.id, leadId: lead.id, followUpReason: "stop" },
        });
      if (i === 3 || i === 7)
        await prisma.whatsappBlockedNumber.create({
          data: { tenantId: tenant.id, phone: canonicalPhone(phone), label: "exemplo" },
        });
    }
    console.log(`✓ ${tenant.name}: 30 contatos (2 bloqueados, 1 pediu para parar).`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
