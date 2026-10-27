/** Só as duas grafias brasileiras do mesmo celular; nunca um LID como telefone. */
export function contactPhoneAliases(phone: string): string[] {
  const aliases = [phone];
  if (/^55\d{2}9\d{8}$/.test(phone)) aliases.push(phone.slice(0, 4) + phone.slice(5));
  else if (/^55\d{2}[6-9]\d{7}$/.test(phone)) aliases.push(phone.slice(0, 4) + "9" + phone.slice(4));
  return aliases;
}
