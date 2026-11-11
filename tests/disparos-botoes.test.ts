import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ conversation: { updateMany: vi.fn() } }));
const appended = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/agent-engine/conversation", () => ({ appendMessage: appended }));

import { parseMetaMessages } from "@/modules/whatsapp/meta-events";
import { isBlockButton } from "@/modules/whatsapp/block-button";
import { handleBlockButton } from "@/modules/whatsapp/button-reply";
import {
  renderBroadcast,
  sameBroadcastTemplate,
  supportedTemplate,
  type BroadcastTemplate,
} from "@/modules/broadcasts/template";
import { metaButtons, validateButtons } from "@/modules/broadcasts/template-buttons";
import {
  managedTemplate,
  templatePayload,
  validateTemplateDraft,
} from "@/modules/broadcasts/template-draft";

const record = {
  id: "t1",
  name: "aviso_ingressos",
  language: "pt_BR",
  status: "APPROVED",
  components: [
    { type: "BODY", text: "Aviso: há novidade sobre os ingressos. Clique no botão para saber mais" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Eu quero" },
        { type: "QUICK_REPLY", text: "Bloquear" },
      ],
    },
  ],
};

describe("Modelos com botões", () => {
  it("aceita resposta rápida e link fixo, e guarda os botões no modelo", () => {
    const t = supportedTemplate(record)!;
    expect(t.buttons).toEqual([
      { type: "QUICK_REPLY", text: "Eu quero" },
      { type: "QUICK_REPLY", text: "Bloquear" },
    ]);
    const link = supportedTemplate({
      ...record,
      components: [record.components[0], { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://s.com/x" }] }],
    })!;
    expect(link.buttons).toEqual([{ type: "URL", text: "Ver", url: "https://s.com/x" }]);
  });

  it("recusa botão que o fechai não sabe enviar (telefone, link com variável)", () => {
    expect(metaButtons([{ type: "PHONE_NUMBER", text: "Ligar" }])).toBeNull();
    expect(metaButtons([{ type: "URL", text: "Ver", url: "https://s.com/{{1}}" }])).toBeNull();
    expect(
      supportedTemplate({
        ...record,
        components: [record.components[0], { type: "BUTTONS", buttons: [{ type: "PHONE_NUMBER", text: "Ligar" }] }],
      }),
    ).toBeNull();
  });

  it("trocar os botões muda o modelo; sem botões continua igual ao antigo", () => {
    const withButtons = supportedTemplate(record)!;
    const without = { ...withButtons, buttons: undefined } as BroadcastTemplate;
    expect(sameBroadcastTemplate(withButtons, withButtons)).toBe(true);
    expect(sameBroadcastTemplate(withButtons, without)).toBe(false);
    const { buttons: _b, ...legacy } = withButtons;
    void _b;
    expect(sameBroadcastTemplate(legacy, without)).toBe(true);
  });

  it("a conversa registra os botões da mensagem", () => {
    expect(renderBroadcast(supportedTemplate(record)!, [])).toMatch(/\n\nBotões: Eu quero · Bloquear$/);
  });

  it("a lista de modelos da conta mostra os botões", () => {
    expect(managedTemplate({ ...record, category: "MARKETING" })!.buttons).toHaveLength(2);
  });
});

describe("Criar modelo com botões", () => {
  const base = { name: "aviso", category: "MARKETING", body: "Há novidade para você." };

  it("monta o componente BUTTONS no pedido à Meta", () => {
    const ok = validateTemplateDraft({
      ...base,
      buttons: [
        { type: "QUICK_REPLY", text: " Eu quero " },
        { type: "QUICK_REPLY", text: "Bloquear" },
      ],
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(templatePayload(ok.draft).components.at(-1)).toEqual({
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Eu quero" },
        { type: "QUICK_REPLY", text: "Bloquear" },
      ],
    });
  });

  it("sem botões o pedido não leva o componente", () => {
    const ok = validateTemplateDraft(base);
    expect(ok.ok && templatePayload(ok.draft).components.some((c) => c.type === "BUTTONS")).toBe(false);
  });

  it("valida quantidade, tamanho, repetição, mistura e link", () => {
    const q = (text: string) => ({ type: "QUICK_REPLY", text });
    expect(validateButtons([q("a"), q("b"), q("c"), q("d")])).toMatchObject({ ok: false });
    expect(validateButtons([q("x".repeat(26))])).toMatchObject({ ok: false });
    expect(validateButtons([q("Sim"), q("sim")])).toMatchObject({ ok: false });
    expect(validateButtons([q("")])).toMatchObject({ ok: false });
    expect(validateButtons([q("Sim"), { type: "URL", text: "Ver", url: "https://s.com" }])).toMatchObject({ ok: false });
    expect(validateButtons([{ type: "URL", text: "Ver", url: "http://s.com" }])).toMatchObject({ ok: false });
    expect(validateButtons([{ type: "URL", text: "Ver", url: "https://s.com/{{1}}" }])).toMatchObject({ ok: false });
    expect(validateButtons([])).toEqual({ ok: true, buttons: [] });
    expect(validateTemplateDraft({ ...base, buttons: "invalid" })).toMatchObject({ ok: false });
  });
});

describe("Toque no botão do modelo", () => {
  const payload = (message: unknown) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "123" },
              contacts: [{ wa_id: "5511987654321", profile: { name: "Ana" } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  });

  it("vira mensagem com o texto do botão (antes era descartada)", () => {
    const [m] = parseMetaMessages(
      payload({
        from: "5511987654321",
        id: "wamid.b1",
        timestamp: "1700000000",
        type: "button",
        button: { text: "Eu quero", payload: "Eu quero" },
      }),
    );
    expect(m).toMatchObject({ text: "Eu quero", replyId: "Eu quero", viaButton: true, fromPhone: "5511987654321" });
  });

  it("texto digitado não é botão", () => {
    const [m] = parseMetaMessages(
      payload({ from: "5511987654321", id: "wamid.t1", timestamp: "1700000000", type: "text", text: { body: "oi" } }),
    );
    expect(m.viaButton).toBeUndefined();
  });

  it("reconhece o botão que pede para parar de receber", () => {
    for (const t of ["Bloquear", "bloquear", "Parar mensagens", "Sair", "Não quero mais receber"])
      expect(isBlockButton(t), t).toBe(true);
    // "Cancelar" é desmarcar consulta, assunto do agente.
    for (const t of ["Eu quero", "Saber mais", "Cancelar", "Quero bloquear a agenda de sábado"])
      expect(isBlockButton(t), t).toBe(false);
  });
});

describe("Botão Bloquear", () => {
  const send = vi.fn(async () => "wamid.conf");
  const input = {
    tenantId: "t1",
    conversationId: "c1",
    phone: "5511987654321",
    externalId: "123",
    provider: { sendMessage: send },
    text: "Bloquear",
    messageKeyId: "wamid.b2",
  };
  beforeEach(() => {
    vi.clearAllMocks();
    db.conversation.updateMany.mockResolvedValue({ count: 1 });
  });

  it("marca pedido de parar só na conversa da própria conta, guarda o toque e confirma", async () => {
    expect(await handleBlockButton(input)).toEqual({ handled: true });
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", tenantId: "t1" },
      data: { followUpReason: "stop" },
    });
    expect(appended).toHaveBeenCalledWith("c1", "user", "Bloquear", undefined, "wamid.b2");
    expect(send).toHaveBeenCalledWith("123", "5511987654321", expect.stringContaining("Não vamos mais enviar"));
  });

  it("se a confirmação falhar, o pedido continua registrado", async () => {
    send.mockRejectedValueOnce(new Error("fora do ar"));
    expect(await handleBlockButton(input)).toEqual({ handled: true });
    expect(db.conversation.updateMany).toHaveBeenCalled();
  });

  it("conversa que não é da conta não é alterada e segue o atendimento normal", async () => {
    db.conversation.updateMany.mockResolvedValue({ count: 0 });
    expect(await handleBlockButton(input)).toEqual({ handled: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("falha no banco nunca lança", async () => {
    db.conversation.updateMany.mockRejectedValue(new Error("db"));
    expect(await handleBlockButton(input)).toEqual({ handled: false });
  });
});
