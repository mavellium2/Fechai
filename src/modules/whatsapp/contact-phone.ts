/** Só as duas grafias brasileiras do mesmo celular; nunca um LID como telefone. */
export function contactPhoneAliases(phone: string): string[] {
  const aliases = [phone];
  if (/^55\d{2}9\d{8}$/.test(phone)) aliases.push(phone.slice(0, 4) + phone.slice(5));
  else if (/^55\d{2}[6-9]\d{7}$/.test(phone)) aliases.push(phone.slice(0, 4) + "9" + phone.slice(4));
  return aliases;
}

/**
 * "(11) 98765-4321" → "5511987654321"; `null` quando não parece um número
 * brasileiro. Aceita com ou sem o 55 e pontuação. Puro, para a tela e o servidor
 * validarem o número digitado pela mesma regra.
 */
export function normalizeBrazilianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return null;
}
