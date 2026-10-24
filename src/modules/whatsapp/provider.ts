// Interface comum da Evolution e da WhatsApp Cloud API oficial. O motor de
// conversa recebe o mesmo contrato independentemente do provider do tenant.

export type WhatsAppStatus = "disconnected" | "pending_qr" | "connected";

export type CreateInstanceResult = {
  externalId: string;
  status: WhatsAppStatus;
  qrCode?: string; // data URL ou base64 do QR, quando pending_qr
};

export type IncomingMessage = {
  instanceExternalId: string;
  fromPhone: string;
  fromName?: string;
  text: string;
  /** true quando a mensagem veio de um grupo do WhatsApp (@g.us). */
  isGroup: boolean;
  /** A mensagem é de áudio (voz ou arquivo) — transcrita antes do turno. */
  hasAudio: boolean;
  /**
   * Duração do áudio em segundos, quando o provedor informa (a Evolution manda
   * `seconds`; a Meta não manda, e o webhook mede o arquivo baixado).
   */
  audioSeconds?: number;
  /** Reação sobreposta a uma mensagem; `isFromMe` identifica quem reagiu. */
  isReaction?: boolean;
  /** A mensagem foi enviada pela própria instância (o número do tenant). */
  isFromMe?: boolean;
  /** id da mensagem no WhatsApp (key.id) — necessário para baixar a mídia. */
  messageKeyId?: string;
  /** id da mídia quando ele difere do id da mensagem (Cloud API da Meta). */
  mediaId?: string;
  /** Instante original do evento; preserva atribuição quando a Meta reentrega. */
  occurredAt?: Date;
  /**
   * Id da opção escolhida numa mensagem interativa (lista ou botão da Meta).
   * `text` leva o título da opção, para o resto do fluxo tratar como texto.
   */
  replyId?: string;
};

export type WhatsAppGroup = {
  /** JID do grupo (`...@g.us`). */
  id: string;
  name: string;
  /** Participantes, quando o provedor informa. */
  size: number | null;
};

export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  createInstance(tenantId: string): Promise<CreateInstanceResult>;
  getQrCode(
    externalId: string,
  ): Promise<{ status: WhatsAppStatus; qrCode?: string }>;
  /**
   * Lê o estado da conexão SEM gerar QR. Existe separado de `getQrCode` porque
   * aquele chama `/instance/connect`, que CRIA um QR a cada chamada e gasta o
   * `QRCODE_LIMIT` da Evolution (30): usá-lo para monitorar em laço queimaria
   * a cota e deixaria a instância `refused`, recusando a leitura justamente
   * quando alguém fosse religar o número.
   *
   * `exists: false` distingue "instância apagada no provedor" de "existe mas
   * está fora do ar" — a primeira só volta criando de novo, a segunda pode
   * voltar sozinha. Nunca lança: monitoramento que derruba o worker não
   * monitora nada.
   */
  getConnectionState?(
    externalId: string,
  ): Promise<{ status: WhatsAppStatus; exists: boolean; reachable: boolean }>;
  /** Envia e devolve o key.id da mensagem no WhatsApp (null se o provedor não o expuser). */
  sendMessage(
    externalId: string,
    toPhone: string,
    text: string,
  ): Promise<string | null>;
  /**
   * Envia áudio como MENSAGEM DE VOZ (PTT) — a bolha com onda e play, não um
   * arquivo anexado. É assim que a resposta em voz do agente chega parecida com
   * o áudio que o contato mandou.
   */
  sendAudio(
    externalId: string,
    toPhone: string,
    audio: { base64: string; mime: string },
  ): Promise<string | null>;
  /** Desconecta do produto. Evolution desloga a sessão; Meta faz disconnect local. */
  disconnect(externalId: string): Promise<void>;
  /**
   * Garante a entrega de webhook no provider. Na Evolution reaponta a URL por
   * instância com header secreto; na Meta inscreve o app no WABA. Devolve
   * false quando faltam dados para automatizar a configuração.
   */
  ensureWebhook(externalId: string): Promise<boolean>;
  /** Baixa a mídia de uma mensagem recebida em base64 (ex.: mensagem de voz). */
  getMediaAsBase64(
    externalId: string,
    messageKeyId: string,
  ): Promise<{ base64: string; mime: string }>;
  /**
   * Envia um aviso para um grupo interno já existente, sem alterar participantes.
   * Opcional: a conexão oficial da Meta não oferece grupos. O chamador trata
   * falhas sem impedir a transferência para humano.
   */
  sendGroupMessage?(
    externalId: string,
    groupId: string,
    text: string,
  ): Promise<string | null>;
  /**
   * Envia uma lista interativa de escolha única (até 10 linhas) — a pesquisa de
   * satisfação a usa para a nota. Opcional: só a Cloud API da Meta tem; no QR a
   * pergunta vai como texto numerado. Devolve o id da mensagem; lança na falha.
   */
  sendRatingPrompt?(
    externalId: string,
    toPhone: string,
    prompt: { body: string; button: string; rows: { id: string; title: string }[] },
  ): Promise<string | null>;
  /**
   * Grupos de que o número conectado participa, para a tela escolher o grupo da
   * transferência em vez de pedir o ID colado. Opcional porque a Cloud API da
   * Meta não expõe grupos. Lança na falha; quem chama decide o que mostrar.
   */
  listGroups?(externalId: string): Promise<WhatsAppGroup[]>;
  // onMessageReceived é implementado via webhook (ver api/webhooks/whatsapp).
  // O provider expõe apenas o parser do payload recebido.
  parseWebhook(payload: unknown): IncomingMessage | null;
}
