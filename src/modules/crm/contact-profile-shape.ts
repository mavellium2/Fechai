/** Limites e formato do formulário de dados do contato. Sem banco: a tela também importa. */
export const CONTACT_NAME_MAX = 80;
export const CONTACT_VALUE_MAX = 500;

export type ContactProfileField = { key: string; description: string; value: string; edited: boolean };

export type ContactProfileData = {
  name: string;
  nameEdited: boolean;
  whatsappName: string | null;
  phone: string;
  /** null = contato sem conversa: ainda não há variáveis para editar. */
  fields: ContactProfileField[] | null;
};
