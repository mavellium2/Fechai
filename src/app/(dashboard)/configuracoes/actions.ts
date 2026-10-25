"use server";

import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "@/lib/password";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { strongPassword } from "@/lib/password-schema";
import { ensureAffiliate } from "@/modules/affiliates/service";
import { getAccountRoles } from "@/modules/affiliates/roles";
import { recordAudit, recordChange } from "@/modules/audit/log";
import { getServiceArea, saveServiceArea } from "@/modules/lead-insights/service-area-store";

type Result = { ok: boolean; error?: string; info?: string };

const profileSchema = z.object({
  name: z.string().trim().min(1, "Informe seu nome"),
});

export async function updateProfile(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { session } = await requireTenant();
  const parsed = profileSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const before = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name },
  });

  await recordChange({
    event: "account.profile_updated",
    target: { type: "User", id: session.user.id, label: session.user.email },
    before: { name: before?.name },
    after: { name: parsed.data.name },
  });

  // O nome exibido na sessão (JWT) só atualiza no próximo login — a página
  // relê do banco, então isso mantém o Server Component em dia.
  revalidatePath("/configuracoes");
  return { ok: true, info: "Perfil atualizado." };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual"),
    // Mesma política do cadastro (lib/password): senha NOVA nasce sob a regra
    // nova, mesmo que a atual seja de antes dela.
    newPassword: strongPassword(),
    confirmPassword: z.string().min(1, "Confirme a nova senha"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export async function changePassword(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { session } = await requireTenant();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) {
    return { ok: false, error: "Esta conta não tem senha configurada." };
  }

  const matches = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!matches) return { ok: false, error: "Senha atual incorreta." };

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Sem `before`/`after`: a troca de senha é registrada como FATO, nunca como
  // estado. Guardar o hash antigo no log daria a quem lesse a trilha um alvo
  // de força bruta e, pior, um caminho para restaurar a senha anterior — o
  // oposto do que trocar a senha significa.
  await recordAudit({
    event: "auth.password_changed",
    target: { type: "User", id: user.id, label: user.email },
  });

  return { ok: true, info: "Senha alterada com sucesso." };
}

/**
 * Liga/desliga os papéis da conta (usar o produto · ser afiliado).
 *
 * Os dois moram em lugares diferentes — `User.usesProduct` e a existência de
 * `Affiliate` — e esta ação é o único ponto que escreve os dois juntos, para
 * não haver duas telas com regras divergentes.
 *
 * Regras:
 *  - **Pelo menos um papel ativo.** Uma conta sem nenhum não teria painel; o
 *    pedido é recusado em vez de deixar a pessoa se trancar para fora.
 *  - **Sair do programa NÃO apaga o cadastro de afiliado.** O registro (código,
 *    indicações, comissões) fica; só some do menu. Apagar destruiria histórico
 *    de dinheiro e mataria links já divulgados — reativar devolve tudo, com o
 *    mesmo código.
 */
export async function updateAccountRoles(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { session } = await requireTenant();

  // Checkbox ausente no FormData = desmarcado.
  const wantsProduct = formData.get("usesProduct") === "on";
  const wantsAffiliate = formData.get("isAffiliate") === "on";

  if (!wantsProduct && !wantsAffiliate) {
    return {
      ok: false,
      error: "Escolha pelo menos uma opção — sua conta precisa de ao menos um uso.",
    };
  }

  const current = await getAccountRoles(session.user.id);

  if (wantsProduct !== current.usesProduct) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { usesProduct: wantsProduct },
    });
  }

  // Entrar no programa cria o cadastro (idempotente, mantém o código de quem
  // já teve um). Sair só desmarca — ver a nota acima sobre não apagar.
  if (wantsAffiliate && !current.isAffiliate) {
    await ensureAffiliate(session.user.id);
  } else if (!wantsAffiliate && current.isAffiliate) {
    // `OPTED_OUT`, e não `SUSPENDED`: saída voluntária não é punição, e a tela
    // de suspensão diz "fale com o suporte" — mensagem errada para quem
    // apertou o botão por vontade própria.
    await prisma.affiliate.update({
      where: { userId: session.user.id },
      data: { status: "OPTED_OUT" },
    });
  } else if (wantsAffiliate && current.isAffiliate) {
    // Volta ao programa com o MESMO código. Só reabre saída voluntária —
    // bloqueio do admin (`SUSPENDED`) não se desfaz por aqui.
    await prisma.affiliate.updateMany({
      where: { userId: session.user.id, status: "OPTED_OUT" },
      data: { status: "ACTIVE" },
    });
  }

  await recordChange({
    event: "account.roles_updated",
    target: { type: "User", id: session.user.id, label: session.user.email },
    // Só `usesProduct` é revertível pela trilha (está na whitelist): o papel de
    // afiliado mora na existência de um `Affiliate`, e desfazê-lo por regravar
    // um campo mexeria num cadastro com histórico de comissão. Quem precisa
    // volta pela própria tela, que já preserva o código.
    before: { usesProduct: current.usesProduct, afiliado: current.isAffiliate },
    after: { usesProduct: wantsProduct, afiliado: wantsAffiliate },
  });

  // O menu vive no layout do painel: revalidar só /configuracoes deixaria a
  // navegação desatualizada até a próxima navegação cheia.
  revalidatePath("/", "layout");
  return { ok: true, info: "Preferências atualizadas." };
}

/**
 * Área de atendimento: a cidade da clínica e as outras que ela atende. É a
 * régua de "dentro/fora do raio" da qualidade dos leads. Mudar a área
 * reclassifica os números na leitura — o que o agente registrou (a cidade que o
 * contato disse) não é regravado.
 */
export async function saveServiceAreaAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { session, tenantId } = await requireTenant();
  const before = await getServiceArea(tenantId);
  const saved = await saveServiceArea(tenantId, { baseCity: formData.get("baseCity"), cities: formData.get("cities") });
  if (!saved.ok) return { ok: false, error: saved.error };

  await recordChange({
    event: "account.service_area_updated",
    target: { type: "Tenant", id: tenantId, label: session.user.email },
    before: before ?? {},
    after: saved.area,
  });
  revalidatePath("/configuracoes");
  revalidatePath("/relatorios");
  return { ok: true, info: "Área de atendimento salva." };
}
