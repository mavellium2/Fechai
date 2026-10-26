import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stopImpersonation } from "@/app/(admin)/actions";

/**
 * Aviso fixo no topo do dashboard enquanto o superadmin vê o painel de outra
 * conta. Ações do painel (conversas, agente, limite) atuam na conta
 * personificada; o único caminho de volta é este botão.
 */
export function ImpersonationBanner({ email }: { email: string }) {
  return (
    <div className="impersonation-banner flex shrink-0 flex-wrap items-center justify-between gap-3 border border-signal/30 bg-signal/10 px-4 py-3 md:px-5">
      <p className="flex min-w-0 items-center gap-2 text-xs leading-relaxed text-ink panel:text-white/85">
        <Eye size={16} aria-hidden className="shrink-0 text-signal" />
        <span className="min-w-0">
          <span className="impersonation-label">Acesso de administrador</span>
          <span className="impersonation-account">Visualizando como <span className="font-semibold break-all text-ink panel:text-white">{email}</span></span>
        </span>
      </p>
      <form action={stopImpersonation}>
        <Button variant="outline" size="sm" type="submit">
          Voltar ao admin
        </Button>
      </form>
    </div>
  );
}
