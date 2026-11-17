type Guidance = { title: string; next: string };

// https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
const guidance: Record<number, Guidance> = {
  10: { title: "A Meta negou a permissão de envio", next: "Confira em Integrações se o token tem acesso ao número e permissão para enviar mensagens." },
  190: { title: "A credencial da Meta expirou ou foi revogada", next: "Atualize a conexão da Meta em Integrações antes de reenviar." },
  368: { title: "A Meta restringiu a conta", next: "Confira o motivo da restrição no Gerenciador do WhatsApp. Aguarde a liberação antes de reenviar." },
  130403: { title: "Contato bloqueado no WhatsApp", next: "Confira o bloqueio no WhatsApp antes de preparar um novo disparo para esse contato." },
  130429: { title: "Limite de velocidade de envio atingido", next: "Aguarde e reduza a frequência de envio antes de tentar novamente." },
  130472: { title: "Entrega limitada por um teste da Meta", next: "A Meta não entregou esta mensagem de marketing. Evite repetir o mesmo envio." },
  131016: { title: "O serviço da Meta está temporariamente indisponível", next: "Aguarde a normalização antes de reenviar." },
  131021: { title: "O destinatário é o próprio número remetente", next: "Corrija o número do contato e prepare um novo disparo." },
  131026: { title: "A Meta não conseguiu entregar neste número", next: "Confirme se o número tem WhatsApp e se o contato consegue escrever para o número da empresa. A Meta não informou a causa exata." },
  131031: { title: "A Meta restringiu a conta ou não validou o acesso", next: "Confira a situação da conta e do número no Gerenciador do WhatsApp." },
  131042: { title: "Problema de cobrança na conta do WhatsApp", next: "Revise o pagamento e o limite de crédito no Gerenciador do WhatsApp antes de reenviar." },
  131048: { title: "A Meta restringiu os envios deste número", next: "Confira a qualidade do número remetente no Gerenciador do WhatsApp e revise a frequência dos disparos. Reenvie só depois que a restrição acabar." },
  131049: { title: "A Meta limitou mensagens de marketing para este contato", next: "Aguarde pelo menos 24 horas antes de tentar novamente. A limitação pode durar mais." },
  131050: { title: "O contato pediu para não receber marketing", next: "Não reenvie mensagens de marketing para este contato." },
  131053: { title: "A Meta não conseguiu carregar o arquivo da mensagem", next: "Confira se o link abre sem login e se o arquivo está no formato e tamanho aceitos. Se o link precisar mudar, prepare um novo disparo." },
  131056: { title: "Muitas mensagens para o mesmo contato em pouco tempo", next: "Aguarde antes de enviar novamente para este número." },
  132000: { title: "Os campos enviados não correspondem ao modelo", next: "Confira as variáveis do modelo e prepare um novo disparo." },
  132001: { title: "Modelo ou idioma indisponível na Meta", next: "Verifique a aprovação e o idioma no Gerenciador do WhatsApp antes de reenviar." },
  132012: { title: "O formato dos campos não corresponde ao modelo", next: "Revise as variáveis e o arquivo do modelo e prepare um novo disparo." },
  132015: { title: "O modelo está pausado na Meta", next: "Confira a qualidade do modelo no Gerenciador do WhatsApp e aguarde a liberação." },
  132016: { title: "O modelo foi desativado pela Meta", next: "Prepare um novo disparo com um modelo aprovado." },
};

/** Lê as referências já gravadas, inclusive os recibos anteriores a esta tela. */
export function broadcastMetaErrorCode(error?: string | null): number | null {
  const match = error?.match(/\bcódigo (\d{1,9})(?=[,).]|$)/i);
  return match ? Number(match[1]) : null;
}

export function broadcastMetaFailure(code: number | null, delivery: boolean): Guidance {
  const known = code === null ? undefined : guidance[code];
  if (known) return known;
  return delivery
    ? { title: "A Meta não confirmou a entrega", next: "A Meta informou uma falha sem explicar a causa. Confira o número e o status da conta; se persistir, informe a referência ao suporte." }
    : { title: "A Meta recusou o envio", next: "Confira a conexão e a aprovação do modelo. Se o erro persistir, informe a referência ao suporte." };
}
