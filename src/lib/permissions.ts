/**
 * Catálogo de permissões do painel, sempre conferido no servidor.
 *
 * É a primeira peça do SEG-05: hoje um login da conta só tem o papel `OWNER`
 * (o suporte, ao personificar, herda o papel do usuário personificado), então
 * esse papel tem todas as permissões abaixo. Quando o SEG-05 trouxer Admin,
 * Atendente e Visualizador, a matriz cresce aqui e os guardas que já chamam
 * `hasPermission` passam a valer sem mudar de lugar.
 *
 * Papel desconhecido ou ausente não tem permissão nenhuma (negar por padrão).
 * Esconder o menu continua sendo só aparência: a tela e a action checam.
 */
export const PERMISSIONS = {
  "crm:ver": "Ver e operar o CRM",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const MATRIX: Record<string, readonly Permission[]> = {
  OWNER: ["crm:ver"],
  // O superadmin só entra no painel da clínica personificando, e aí o papel é o do usuário.
  SUPERADMIN: [],
};

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  if (!role || !Object.hasOwn(MATRIX, role)) return false;
  return MATRIX[role].includes(permission);
}
