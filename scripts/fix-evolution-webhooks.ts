import { prisma } from "../src/lib/prisma";
import { getWhatsAppProvider } from "../src/modules/whatsapp";

// Reaponta TODAS as instâncias de WhatsApp já existentes para o webhook por
// instância (com o header `x-webhook-secret`).
//
// Por que existe: até esta correção o compose ligava o webhook GLOBAL da
// Evolution, que não sabe mandar header nenhum. A rota do fechai recusa (401)
// tudo sem o segredo, e 401 está entre os status que a Evolution considera
// definitivos — a mensagem era descartada, não reenfileirada. Ou seja: número
// "conectado" na tela, zero mensagem entrando, e nada na fila para recuperar.
//
// `connectWhatsapp()` já reaponta o webhook sozinho a cada conexão, então
// contas que clicarem em "Conectar" se consertam sem isto. Este script é para
// quem JÁ está conectado e não tem motivo nenhum para clicar lá de novo.
//
// Rode uma vez após o deploy:  npm run whatsapp:webhooks
async function main() {
  const provider = getWhatsAppProvider("evolution");
  if (!provider.isConfigured()) {
    console.error("[whatsapp:webhooks] EVOLUTION_API_URL / EVOLUTION_API_KEY ausentes.");
    process.exit(1);
  }
  if (!process.env.EVOLUTION_WEBHOOK_URL || !process.env.WHATSAPP_WEBHOOK_SECRET) {
    console.error(
      "[whatsapp:webhooks] defina EVOLUTION_WEBHOOK_URL e WHATSAPP_WEBHOOK_SECRET — " +
        "sem os dois não há webhook para apontar.",
    );
    process.exit(1);
  }

  const instances = await prisma.whatsappInstance.findMany({
    // QR desligado pelo admin: reapontar o webhook seria religar o que foi bloqueado.
    where: {
      provider: "evolution",
      externalId: { not: null },
      tenant: { evolutionWhatsappEnabled: true },
    },
    select: { externalId: true, tenantId: true, status: true },
  });

  let ok = 0;
  let failed = 0;
  for (const instance of instances) {
    try {
      await provider.ensureWebhook(instance.externalId!);
      ok += 1;
    } catch (err) {
      failed += 1;
      // Segue para as próximas: uma instância apagada na Evolution (404) não
      // pode impedir o conserto das outras.
      console.error(`[whatsapp:webhooks] ${instance.externalId} falhou:`, err);
    }
  }

  console.log(`[whatsapp:webhooks] ${ok} configurada(s), ${failed} com falha.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
