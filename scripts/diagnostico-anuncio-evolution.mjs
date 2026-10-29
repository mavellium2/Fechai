// Diagnóstico SOMENTE LEITURA: o Evolution guardou o dado do anúncio (Click-to-WhatsApp)
// nas primeiras mensagens de um lead?
//
// Uso (sem dependências, roda com node puro):
//   EVOLUTION_API_URL=https://... EVOLUTION_API_KEY=... \
//   node scripts/diagnostico-anuncio-evolution.mjs --phone 5514998586900 [--instance NOME] [--limit 5]
//
// Só chama /instance/fetchInstances e /chat/findMessages. Não grava nada, não envia
// nada, não baixa mídia. Na saída NÃO vão telefone, nome nem texto do paciente:
// só a forma da mensagem, a data, os campos de anúncio e o código [ADnn - ...]
// quando ele aparece numa mensagem enviada pela clínica.

const base = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
const apikey = process.env.EVOLUTION_API_KEY ?? "";
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const phone = (arg("phone") ?? "").replace(/\D/g, "");
const only = arg("instance");
const limit = Math.max(1, Number(arg("limit") ?? 5) || 5);

if (!base || !apikey || phone.length < 10) {
  console.error("Faltam EVOLUTION_API_URL, EVOLUTION_API_KEY ou --phone (só dígitos, com 55).");
  process.exit(1);
}

const call = async (path, body) => {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", apikey },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
};

// O WhatsApp antigo omite o 9 depois do DDD; tenta as duas formas.
const variants = (p) => {
  const out = new Set([p]);
  if (p.startsWith("55") && p.length === 13 && p[4] === "9") out.add(p.slice(0, 4) + p.slice(5));
  return [...out];
};

const AD_KEY = /externalAdReply|ctwa|referral|sourceId|sourceType|sourceUrl|adTitle|conversionSource|entryPoint|greeting|automated|isAd/i;
const SKIP_KEY = /thumbnail|jpegThumbnail|base64/i;

// Procura qualquer chave relacionada a anúncio, em qualquer profundidade.
function walk(node, path, found, depth = 0) {
  if (node === null || typeof node !== "object" || depth > 8) return;
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_KEY.test(k)) continue;
    const here = path ? `${path}.${k}` : k;
    if (AD_KEY.test(k) && v !== null && typeof v !== "object") {
      const shown = /ctwa/i.test(k) ? `<presente, ${String(v).length} caracteres>` : String(v).slice(0, 100);
      found.push(`${here} = ${shown}`);
    } else if (AD_KEY.test(k) && v && typeof v === "object") {
      found.push(`${here} = <objeto: ${Object.keys(v).filter((x) => !SKIP_KEY.test(x)).join(", ")}>`);
      walk(v, here, found, depth + 1);
    } else {
      walk(v, here, found, depth + 1);
    }
  }
}

async function instanceNames() {
  if (only) return [only];
  const list = await call("/instance/fetchInstances");
  return (Array.isArray(list) ? list : [])
    .map((i) => i?.name ?? i?.instanceName ?? i?.instance?.instanceName)
    .filter(Boolean);
}

async function findRecords(instance, jid) {
  const data = await call(`/chat/findMessages/${encodeURIComponent(instance)}`, {
    where: { key: { remoteJid: jid } },
    page: 1,
    offset: 100,
  });
  return data?.messages?.records ?? [];
}

// Modo varredura (--dias N): olha TODAS as mensagens dos últimos N dias da instância,
// sem filtrar por telefone. Serve para achar mensagens do lead guardadas sob outro
// identificador (@lid) e para contar quantas trazem dado de anúncio.
const dias = Number(arg("dias") ?? 0);
if (dias > 0) {
  const until = new Date();
  const since = new Date(until.getTime() - dias * 86_400_000);
  const digits = variants(phone);
  for (const instance of await instanceNames()) {
    const all = [];
    for (let page = 1; page <= 50; page++) {
      const data = await call(`/chat/findMessages/${encodeURIComponent(instance)}`, {
        where: { messageTimestamp: { gte: since.toISOString(), lte: until.toISOString() } },
        page,
        offset: 100,
      });
      const m = data?.messages;
      all.push(...(m?.records ?? []));
      if (!m || page >= Number(m.pages ?? 0)) break;
    }
    const withAd = [];
    const jidKinds = {};
    let fromLead = 0;
    for (const r of all) {
      const jid = String(r.key?.remoteJid ?? "");
      const kind = jid.endsWith("@lid") ? "@lid" : jid.endsWith("@s.whatsapp.net") ? "telefone" : jid.endsWith("@g.us") ? "grupo" : "outro";
      const k = `${r.key?.fromMe ? "enviada" : "recebida"}/${kind}`;
      jidKinds[k] = (jidKinds[k] ?? 0) + 1;
      const found = [];
      walk(r, "", found);
      // "é o lead do print": o número aparece em qualquer lugar do registro (sem imprimir o número).
      const isLead = digits.some((d) => JSON.stringify(r).includes(d));
      if (isLead) fromLead++;
      if (found.length) withAd.push({ r, found, isLead });
    }
    console.log(`\n=== instância ${instance} · últimos ${dias} dias · ${all.length} mensagens ===`);
    console.log("por tipo (direção/identificador):", JSON.stringify(jidKinds));
    console.log(`mensagens ligadas ao número do print: ${fromLead}`);
    console.log(`mensagens com algum campo de anúncio: ${withAd.length}`);
    withAd.sort((a, b) => Number(b.isLead) - Number(a.isLead));
    for (const { r, found, isLead } of withAd.slice(0, limit)) {
      const when = new Date(Number(r.messageTimestamp) * 1000).toISOString().slice(0, 16).replace("T", " ");
      console.log(`\n- ${when} UTC · ${r.key?.fromMe ? "enviada" : "recebida"} · ${isLead ? "É O LEAD DO PRINT" : "outro lead"}`);
      found.forEach((f) => console.log(`   anúncio: ${f}`));
    }
  }
  process.exit(0);
}

let achou = false;
for (const instance of await instanceNames()) {
  for (const p of variants(phone)) {
    let records;
    try {
      records = await findRecords(instance, `${p}@s.whatsapp.net`);
    } catch (e) {
      console.log(`[${instance}] erro: ${e.message}`);
      continue;
    }
    if (!records.length) continue;
    achou = true;
    records.sort((a, b) => Number(a.messageTimestamp) - Number(b.messageTimestamp));
    console.log(`\n=== instância ${instance} · ${records.length} mensagens no total · mostrando as ${Math.min(limit, records.length)} primeiras ===`);
    for (const [i, r] of records.slice(0, limit).entries()) {
      const when = new Date(Number(r.messageTimestamp) * 1000).toISOString().slice(0, 16).replace("T", " ");
      const msg = r.message ?? {};
      const found = [];
      walk(r, "", found);
      const text = msg.conversation ?? msg.extendedTextMessage?.text ?? "";
      const code = r.key?.fromMe ? text.match(/\[AD\d+[^\]]*\]/i)?.[0] : undefined;
      console.log(`\n#${i + 1} ${when} UTC · ${r.key?.fromMe ? "enviada pela clínica" : "do lead"} · tipo: ${Object.keys(msg).filter((k) => k !== "messageContextInfo").join(", ") || "(vazio)"}`);
      if (code) console.log(`   código no texto da clínica: ${code}`);
      if (found.length) found.forEach((f) => console.log(`   anúncio: ${f}`));
      else console.log("   anúncio: nenhum campo de anúncio nesta mensagem");
    }
    break; // achou a conversa com esta variante do número
  }
}

if (!achou) {
  console.log("Nenhuma mensagem encontrada para esse número em nenhuma instância. Pode ser um contato @lid; confirme o número ou passe --instance.");
}
