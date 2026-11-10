import ExcelJS from "exceljs";
import { normalizeBroadcastPhone, broadcastPhoneVariants } from "./phone";
import { renderBroadcast, type BroadcastTemplate } from "./template";
import { mediaFilenameFromUrl, mediaLinkProblem } from "./media";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
import { MAX_RECIPIENTS } from "./contacts";
export { MAX_RECIPIENTS };
export type ImportedRecipient = {
  row: number;
  phone: string;
  name: string | null;
  parameters: string[];
  content: string;
  /** "nameless" = recebe a versão sem nome do disparo. Ausente = "main". */
  variant?: "main" | "nameless";
  /** Arquivo do topo (template com mídia). */
  mediaUrl?: string | null;
  mediaFilename?: string | null;
};
export type ColumnMapping = {
  phone: string;
  name?: string;
  parameters: string[];
  /** Coluna com o link do arquivo de cada contato (template com mídia). */
  media?: string;
};
export type ImportResult = {
  recipients: ImportedRecipient[];
  issues: { row: number; error: string }[];
  duplicates: number;
  total: number;
};

function key(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function scalar(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Número inválido.");
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Use somente texto ou números nas células.");
  const text = String(value).trim();
  if (text.length > 1024) throw new Error("Célula acima de 1.024 caracteres.");
  return text;
}

export function parseBroadcastRows(
  rows: { row: number; value: unknown }[],
  template: BroadcastTemplate,
  mapping?: ColumnMapping,
): ImportResult {
  if (!rows.length) throw new Error("O arquivo está vazio.");
  if (rows.length > MAX_RECIPIENTS)
    throw new Error(`O limite é de ${MAX_RECIPIENTS} contatos por arquivo.`);
  if (
    mapping &&
    (typeof mapping.phone !== "string" ||
      !mapping.phone ||
      (mapping.name !== undefined && typeof mapping.name !== "string") ||
      !Array.isArray(mapping.parameters) ||
      mapping.parameters.length !== template.parameterCount ||
      mapping.parameters.some((p) => typeof p !== "string" || !p) ||
      (mapping.media !== undefined && typeof mapping.media !== "string"))
  )
    throw new Error(
      "Associe o telefone e todas as variáveis às colunas do arquivo.",
    );
  const selected = mapping
    ? new Set(
        [mapping.phone, mapping.name ?? "", mapping.media ?? "", ...mapping.parameters].map(key),
      )
    : null;
  const result: ImportResult = {
    recipients: [],
    issues: [],
    duplicates: 0,
    total: rows.length,
  };
  const seen = new Set<string>();
  for (const { row, value } of rows) {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Cada contato deve ser um objeto com telefone.");
      const fields = new Map<string, string>();
      for (const [name, val] of Object.entries(value)) {
        const normalized = key(name);
        if (fields.has(normalized))
          throw new Error("Colunas com nomes repetidos.");
        fields.set(
          normalized,
          !selected || selected.has(normalized) ? scalar(val) : "",
        );
      }
      const phone = normalizeBroadcastPhone(
        mapping
          ? fields.get(key(mapping.phone))
          : (fields.get("telefone") ??
              fields.get("phone") ??
              fields.get("whatsapp")),
      );
      if (!phone)
        throw new Error(
          "Telefone inválido. Inclua DDI e DDD, por exemplo +55 11 98765-4321.",
        );
      const parameters = Array.from(
        { length: template.parameterCount },
        (_, i) => {
          const param = fields.get(
            mapping ? key(mapping.parameters[i]) : `var_${i + 1}`,
          );
          if (!param || /[\r\n\t]| {5}/.test(param))
            throw new Error(
              `Preencha var_${i + 1} com texto em uma linha, sem tabulações ou espaços excessivos.`,
            );
          return param;
        },
      );
      // Link por contato: só quando a mensagem tem mídia e a coluna foi escolhida.
      let media: { mediaUrl: string; mediaFilename: string | null } | null = null;
      if (template.mediaFormat && mapping?.media) {
        const link = fields.get(key(mapping.media)) ?? "";
        const problem = mediaLinkProblem(link);
        if (problem) throw new Error(problem);
        media = { mediaUrl: link, mediaFilename: mediaFilenameFromUrl(link) };
      }
      const content = renderBroadcast(template, parameters);
      if (content.length > 4096)
        throw new Error("Mensagem preenchida acima de 4.096 caracteres.");
      const name = mapping
        ? mapping.name
          ? fields.get(key(mapping.name)) || null
          : null
        : fields.get("nome") || fields.get("name") || null;
      if (name && name.length > 120)
        throw new Error("Nome acima de 120 caracteres.");
      const duplicateKey = broadcastPhoneVariants(phone).sort(
        (a, b) => a.length - b.length,
      )[0];
      if (seen.has(duplicateKey)) {
        result.duplicates++;
        continue;
      }
      seen.add(duplicateKey);
      result.recipients.push({ row, phone, name, parameters, content, ...media });
    } catch (error) {
      result.issues.push({
        row,
        error: error instanceof Error ? error.message : "Linha inválida.",
      });
    }
  }
  return result;
}

/** Limita o tamanho declarado do ZIP antes de descompactar (XLSX é um ZIP). */
function validateXlsxZip(bytes: Buffer) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Arquivo Excel inválido. Salve como .xlsx.");
  const entries = bytes.readUInt16LE(end + 10);
  let position = bytes.readUInt32LE(end + 16);
  let size = 0;
  if (entries > 2000)
    throw new Error(
      "Planilha complexa demais. Exporte apenas a lista de contatos.",
    );
  for (let i = 0; i < entries; i++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50)
      throw new Error("Arquivo Excel inválido.");
    size += bytes.readUInt32LE(position + 24);
    if (size > 20 * 1024 * 1024)
      throw new Error(
        "Planilha descompactada acima de 20 MB. Exporte apenas os contatos.",
      );
    position +=
      46 +
      bytes.readUInt16LE(position + 28) +
      bytes.readUInt16LE(position + 30) +
      bytes.readUInt16LE(position + 32);
  }
}

export async function readBroadcastFile(
  file: File,
): Promise<{ row: number; value: unknown }[]> {
  if (!file.size || file.size > MAX_IMPORT_BYTES)
    throw new Error("Envie um arquivo de até 2 MB, com conteúdo.");
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "json") {
    let data: unknown;
    try {
      data = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    } catch {
      throw new Error(
        "JSON inválido. Use uma lista de objetos com telefone, nome e variáveis.",
      );
    }
    if (!Array.isArray(data))
      throw new Error("O JSON deve conter uma lista de contatos: [{ ... }].");
    const columns = new Set(
      data.flatMap((row) =>
        row && typeof row === "object" && !Array.isArray(row)
          ? Object.keys(row).map(key)
          : [],
      ),
    );
    if (columns.size > 30) throw new Error("Use até 30 colunas no arquivo.");
    if (data.length > MAX_RECIPIENTS)
      throw new Error("O limite é de 1000 contatos por arquivo.");
    return data.map((value, i) => ({ row: i + 1, value }));
  }
  if (extension !== "xlsx")
    throw new Error(
      "Use Excel (.xlsx) ou JSON (.json). Para .xls, salve como .xlsx primeiro.",
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  validateXlsxZip(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error(
      "Não foi possível ler o Excel. Salve uma nova cópia como .xlsx, sem senha.",
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2)
    throw new Error("A primeira aba precisa conter cabeçalhos e contatos.");
  if (sheet.rowCount > MAX_RECIPIENTS + 1 || sheet.columnCount > 30)
    throw new Error(
      "Use até 1.000 linhas de contatos e 30 colunas na primeira aba.",
    );
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column - 1] = key(scalar(cell.value));
  });
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw new Error("Use cabeçalhos preenchidos e sem nomes repetidos.");
  const rows: { row: number; value: unknown }[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    rows.push({
      row: index,
      value: Object.fromEntries(
        headers.map((header, i) => [header, row.getCell(i + 1).value]),
      ),
    });
  });
  return rows;
}

export async function parseBroadcastFile(
  file: File,
  template: BroadcastTemplate,
  mapping?: ColumnMapping,
): Promise<ImportResult> {
  return parseBroadcastRows(await readBroadcastFile(file), template, mapping);
}
export async function inspectBroadcastFile(file: File) {
  const rows = await readBroadcastFile(file);
  if (!rows.length) throw new Error("O arquivo está vazio.");
  const columns = [
    ...new Set(
      rows.flatMap((r) =>
        r.value && typeof r.value === "object" && !Array.isArray(r.value)
          ? Object.keys(r.value).map(key)
          : [],
      ),
    ),
  ];
  if (!columns.length || columns.length > 30)
    throw new Error("Use entre 1 e 30 colunas com cabeçalhos.");
  return { columns, total: rows.length };
}
