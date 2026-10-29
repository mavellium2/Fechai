// Diagnóstico SOMENTE LEITURA: o Evolution guardou o dado do anúncio (Click-to-WhatsApp)
// das mensagens de um lead?
//
// Uso (sem dependências, roda com node puro):
//   EVOLUTION_API_URL=http://127.0.0.1:8080 EVOLUTION_API_KEY=... \
//   node scripts/diagnostico-anuncio-evolution.mjs --instance NOME --semanas 16
//   node scripts/diagnostico-anuncio-evolution.mjs --phone 5514998586900 [--instance NOME]
//
// Só chama /instance/fetchInstances e /chat/findMessages. Não grava nada, não envia
// nada, não baixa mídia. Na saída NÃO vão telefone, nome nem texto do paciente:
// só datas, contagens, ids de anúncio e o código [ADnn - ...] da campanha.

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
const semanas = Number(arg("semanas") ?? 0);

if (!base || !apikey || (!semanas && phone.length < 10)) {
  console.error("Faltam EVOLUTION_API_URL, EVOLUTION_API_KEY e --phone (só dígitos, com 55) ou --semanas N.");
  process.exit(1);
}

const call = async (path, body) => {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", apikey },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
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

// Anúncio DE VERDADE: só o objeto externalAdReply (o walk acima é largo de propósito
// para descobrir campos, e pega falsos positivos como imageSourceType).
function findAdReply(node, depth = 0) {
  if (node === null || typeof node !== "object" || depth > 8) return null;
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_KEY.test(k)) continue;
    if (k === "externalAdReply" && v && typeof v === "object") return v;
    const inner = findAdReply(v, depth + 1);
    if (inner) return inner;
  }
  return null;
}
const adCode = (ad) => String(ad?.greetingMessageBody ?? "").match(/\[(AD\d+)\s*-\s*([^\]]+)\]/i);

async function instanceNames() {
  if (only) return [only];
  const list = await call("/instance/fetchInstances");
  return (Array.isArray(list) ? list : [])
    .map((i) => i?.name ?? i?.instanceName ?? i?.instance?.instanceName)
    .filter(Boolean);
}

const PAGE = 100;
const MAX_PAGES = 50; // 5000 mensagens por fatia; se bater, o script avisa em vez de fingir que leu tudo.

async function readSlice(instance, since, until, where = {}) {
  const records = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await call(`/chat/findMessages/${encodeURIComponent(instance)}`, {
      where: { ...where, messageTimestamp: { gte: since.toISOString(), lte: until.toISOString() } },
      page,
      offset: PAGE,
    });
    const m = data?.messages;
    records.push(...(m?.records ?? []));
    if (!m || page >= Number(m.pages ?? 0)) return { records, truncated };
  }
  return { records, truncated: true };
}

// Modo por semana (--semanas N): lê a instância em fatias de 7 dias, da mais recente
// para trás. Mostra até onde o histórico existe e quantos leads de anúncio por semana.
if (semanas > 0) {
  const WEEK = 7 * 86_400_000;
  for (const instance of await instanceNames()) {
    let until = new Date();
    let oldest = null;
    const rows = [];
    for (let w = 0; w < semanas; w++) {
      const since = new Date(until.getTime() - WEEK);
      const { records, truncated } = await readSlice(instance, since, until);
      if (records.length) oldest = since;
      const leads = new Set();
      const ads = new Map();
      for (const r of records) {
        const ad = findAdReply(r);
        if (!ad || r.key?.fromMe) continue;
        leads.add(r.key?.remoteJid);
        const code = adCode(ad);
        const label = code ? `${code[1].toUpperCase()} - ${code[2].trim()}` : `sem código (sourceId ${ad.sourceId ?? "?"})`;
        ads.set(label, (ads.get(label) ?? 0) + 1);
      }
      rows.push({ since, total: records.length, leads: leads.size, ads, truncated });
      until = since;
    }
    if (!rows.some((r) => r.total)) continue;
    console.log(`\n=== instância ${instance} ===`);
    for (const r of rows) {
      const d = r.since.toISOString().slice(0, 10);
      console.log(`semana desde ${d}: ${r.total} mensagens · ${r.leads} leads de anúncio${r.truncated ? " · ⚠ LIMITE de 5000 atingido, contagem incompleta" : ""}`);
      for (const [label, n] of [...r.ads].sort((a, b) => b[1] - a[1])) console.log(`     ${n}× ${label}`);
    }
    console.log(oldest
      ? `\nMensagem mais antiga encontrada: semana desde ${oldest.toISOString().slice(0, 10)}`
      : "\nNenhuma mensagem na janela.");
    const last = rows[rows.length - 1];
    if (last.total) console.log(`⚠ A semana mais antiga lida (${last.since.toISOString().slice(0, 10)}) ainda tinha mensagens: o histórico pode voltar além de ${semanas} semanas. Rode com --semanas maior.`);
  }
  process.exit(0);
}

// Modo telefone: mostra as primeiras mensagens de um número e os campos de anúncio.
let achou = false;
for (const instance of await instanceNames()) {
  for (const p of variants(phone)) {
    let records;
    try {
      ({ records } = await readSlice(instance, new Date(0), new Date(), { key: { remoteJid: `${p}@s.whatsapp.net` } }));
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
      console.log(`\n#${i + 1} ${when} UTC · ${r.key?.fromMe ? "enviada pela clínica" : "do lead"} · tipo: ${Object.keys(msg).filter((k) => k !== "messageContextInfo").join(", ") || "(vazio)"}`);
      if (found.length) found.forEach((f) => console.log(`   anúncio: ${f}`));
      else console.log("   anúncio: nenhum campo de anúncio nesta mensagem");
    }
    break;
  }
}

if (!achou) {
  console.log("Nenhuma mensagem encontrada para esse número pelo telefone. Se o contato for @lid, use o modo --semanas.");
}
