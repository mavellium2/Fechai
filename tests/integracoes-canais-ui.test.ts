import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Cartões de conexão em `/integracoes`.
 *
 * Sem a Meta liberada, o cartão do WhatsApp é um só e junta conexão, atendimento
 * e bloqueios (como sempre foi). Com ela, cada conexão é um cartão só de
 * conexão — e "Desconectar" é dela —, e o que é da CONTA (pausar o agente,
 * grupos, bloqueados) sai dos cartões de conexão. Se voltasse a aparecer dentro
 * de cada um, o dono acharia que pausar o agente no cartão da Meta só cala a
 * Meta.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(dashboard)/integracoes/actions", () => ({
  connectWhatsapp: vi.fn(),
  refreshWhatsappStatus: vi.fn(),
  disconnectWhatsapp: vi.fn(),
  reconnectMetaWhatsapp: vi.fn(),
  saveMetaWhatsapp: vi.fn(),
  setWhatsappAgentEnabled: vi.fn(),
  setWhatsappAgentReplies: vi.fn(),
  setWhatsappIgnoreGroups: vi.fn(),
  blockWhatsappNumber: vi.fn(),
  unblockWhatsappNumber: vi.fn(),
}));

import { WhatsappConnect } from "@/app/(dashboard)/integracoes/WhatsappConnect";
import { MetaWhatsappConnect } from "@/app/(dashboard)/integracoes/MetaWhatsappConnect";
import {
  AttendanceControls,
  DisconnectControl,
} from "@/app/(dashboard)/integracoes/WhatsappControls";

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

const single = (over: Record<string, unknown> = {}) =>
  render(
    createElement(WhatsappConnect, {
      initialStatus: "connected",
      configured: true,
      agentName: "Paula",
      agentEnabled: true,
      ignoreGroups: true,
      blocked: [],
      ...over,
    }),
  );

const channel = (over: Record<string, unknown> = {}) =>
  render(
    createElement(WhatsappConnect, {
      layout: "channel",
      initialStatus: "connected",
      configured: true,
      ...over,
    }),
  );

const meta = (over: Record<string, unknown> = {}) =>
  render(
    createElement(MetaWhatsappConnect, {
      embeddedSignup: null,
      usesEmbeddedSignup: false,
      connected: true,
      agentReplies: true,
      encryptionConfigured: true,
      hasCredentials: true,
      displayPhone: "+55 14 99999-0000",
      phoneNumberId: "109876543210",
      businessAccountId: "209876543210",
      webhookUrl: "https://fechai.test/api/webhooks/whatsapp/meta/tenant-1",
      verifyToken: "token-de-verificacao",
      ...over,
    }),
  );

describe("Cartão único (conta sem a Meta liberada)", () => {
  it("continua juntando conexão, atendimento, desconectar e bloqueados", () => {
    const html = single();
    expect(html).toContain("Seu número está atendendo");
    expect(html).toContain("Paula está respondendo");
    expect(html).toContain("Desconectar número");
    expect(html).toContain("Números bloqueados");
  });

  it("desconectado não oferece desconectar, mas mantém o atendimento e os bloqueados", () => {
    const html = single({ initialStatus: "disconnected" });
    expect(html).not.toContain("Desconectar número");
    expect(html).toContain("Atendimento");
    expect(html).toContain("Números bloqueados");
  });

  it("pausar o agente fala 'neste número', porque só há um", () => {
    expect(single()).toContain("neste número");
  });
});

describe("Cartão do QR code (conta com as duas conexões)", () => {
  it("é só a conexão: tem 'Desconectar', e não tem atendimento nem bloqueados", () => {
    const html = channel();
    expect(html).toContain("Seu número está atendendo");
    expect(html).toContain("Desconectar número");
    expect(html).not.toContain("está respondendo");
    expect(html).not.toContain("Ignorar mensagens de grupos");
    expect(html).not.toContain("Números bloqueados");
  });

  it("desconectado não oferece desconectar", () => {
    const html = channel({ initialStatus: "disconnected" });
    expect(html).not.toContain("Desconectar número");
    expect(html).toContain("Gerar código");
  });

  it("sem gerar o código sozinho: o botão espera o clique quando `autoStart` é falso", () => {
    // O efeito que gera o QR não roda na renderização estática; o que dá para
    // travar aqui é que o estado inicial não finge ter um código.
    const html = channel({ initialStatus: "disconnected", autoStart: false });
    expect(html).toContain("Gere um código para conectar seu número.");
    expect(html).not.toContain("data:image/png");
  });
});

describe("Cartão da API oficial da Meta", () => {
  it("oferece refazer a conexão e preserva o celular, sem expor o segredo do callback compartilhado", () => {
    const html = meta({ embeddedSignup: { appId: "123456", configId: "654321", version: "v26.0" }, usesEmbeddedSignup: true });
    expect(html).toContain("Refazer conexão pela Meta");
    expect(html).toContain("confirme no celular");
    expect(html).toContain("histórico antigo continua no celular");
    expect(html).not.toContain("token-de-verificacao");
    expect(html).not.toContain("api/webhooks/whatsapp/meta/tenant-1");
  });
  it("conectado: mostra o número, o webhook, o verify token e o desconectar da Meta", () => {
    const html = meta();
    expect(html).toContain("+55 14 99999-0000");
    expect(html).toContain("https://fechai.test/api/webhooks/whatsapp/meta/tenant-1");
    expect(html).toContain("token-de-verificacao");
    expect(html).toContain("Desconectar número");
    expect(html).toContain("As credenciais ficam salvas");
  });

  it("nunca traz atendimento nem bloqueados: são da conta", () => {
    const html = meta();
    expect(html).not.toContain("está respondendo");
    expect(html).not.toContain("Números bloqueados");
  });

  it("avisa que o número precisa ser diferente do conectado por QR code", () => {
    for (const html of [meta(), meta({ connected: false, hasCredentials: false })]) {
      expect(html).toContain("Use um número diferente do conectado por QR code");
    }
  });

  it("sem credenciais: pede o cadastro, sem desconectar", () => {
    const html = meta({ connected: false, hasCredentials: false, displayPhone: null, phoneNumberId: null, businessAccountId: null });
    expect(html).toContain("Credenciais da Meta");
    expect(html).toContain("Validar e conectar");
    expect(html).not.toContain("Desconectar número");
  });

  it("credenciais guardadas e desconectado: oferece reconectar", () => {
    const html = meta({ connected: false });
    expect(html).toContain("Reconectar com a Meta");
    expect(html).not.toContain("Desconectar número");
  });

  it("conectado: oferece deixar o número só para Disparos", () => {
    expect(meta()).toContain("O agente responde por este número");
    expect(meta({ agentReplies: false })).toContain("Este número só faz disparos");
  });

  it("desconectado não mostra a chave do agente", () => {
    expect(meta({ connected: false })).not.toContain("O agente responde por este número");
  });
});

describe("Atendimento da conta", () => {
  it("com as duas conexões, fala de todos os números conectados", () => {
    const html = render(
      createElement(AttendanceControls, { agentName: "Paula", agentEnabled: true, ignoreGroups: true, allNumbers: true, as: "h3" }),
    );
    expect(html).toContain("em todos os números conectados");
    expect(html).toContain("<h3");
    expect(html).toContain("Ignorar mensagens de grupos");
  });

  it("agente em silêncio: oferece retomar em todos os números", () => {
    const html = render(
      createElement(AttendanceControls, { agentName: "Paula", agentEnabled: false, ignoreGroups: true, allNumbers: true }),
    );
    expect(html).toContain("Paula está em silêncio");
    expect(html).toContain("voltar a responder em todos os números conectados");
  });

  it("grupos só existem no QR: pode esconder a opção", () => {
    const html = render(
      createElement(AttendanceControls, { agentName: "Paula", agentEnabled: true, ignoreGroups: true, showGroups: false }),
    );
    expect(html).not.toContain("grupos");
  });
});

describe("Desconectar uma conexão", () => {
  it("o texto da Meta fala em credenciais guardadas; o do QR, em novo código", () => {
    expect(render(createElement(DisconnectControl, { provider: "meta" }))).toContain("credenciais ficam salvas");
    expect(render(createElement(DisconnectControl, { provider: "evolution" }))).toContain("novo código");
  });

  it("dá ids diferentes ao texto de apoio, para as duas conexões conviverem na mesma página", () => {
    const a = render(createElement(DisconnectControl, { provider: "meta" }));
    const b = render(createElement(DisconnectControl, { provider: "evolution" }));
    expect(a).toContain('id="whatsapp-disconnect-desc-meta"');
    expect(b).toContain('id="whatsapp-disconnect-desc-evolution"');
  });
});
