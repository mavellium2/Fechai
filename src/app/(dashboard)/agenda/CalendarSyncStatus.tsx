import Link from "next/link";
import { Apple, CalendarCheck2, Stethoscope, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";

export type CalendarSyncItem = {
  key: "google" | "clinicorp" | "icloud";
  name: string;
  /** Habilitado em /integracoes mas ainda sem credencial. */
  connected: boolean;
  /** Espelha os horários marcados aqui no sistema do outro lado. */
  sending: boolean;
  /** Lê a agenda de lá para não marcar em cima do que já está ocupado. */
  receiving: boolean;
  /** Última falha, quando houver — a credencial pode ter vencido. */
  error?: string | null;
};

const ICONS = {
  google: CalendarCheck2,
  clinicorp: Stethoscope,
  icloud: Apple,
} as const;

/**
 * O que a agenda mostra sobre as integrações: só o estado.
 *
 * Conectar e configurar acontece em /integracoes — um lugar só para ligar
 * coisas. Aqui a pessoa que está olhando a agenda precisa de outra resposta:
 * "o que eu marcar agora vai chegar na clínica?". Daí ser status, e não
 * formulário, com link para quem quiser mexer.
 *
 * Server Component: é leitura pura, nada aqui precisa de estado no cliente.
 */
export function CalendarSyncStatus({ items }: { items: CalendarSyncItem[] }) {
  if (items.length === 0) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-white">Sincronização</h2>
        <Link
          href="/integracoes?aba=calendarios"
          className="shrink-0 rounded-control font-mono text-micro uppercase tracking-wide text-iris underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          Gerenciar
        </Link>
      </div>

      <ul className="space-y-3">
        {items.map((item) => {
          const Icon = ICONS[item.key];

          return (
            <li key={item.key} className="flex items-start gap-2.5">
              <Icon
                size={16}
                aria-hidden
                className={`mt-0.5 shrink-0 ${item.error ? "text-warn" : item.connected ? "text-success" : "text-white/40"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white">{item.name}</p>

                {!item.connected ? (
                  <p className="mt-0.5 text-xs text-white/50">
                    Habilitado, falta conectar.{" "}
                    <Link
                      href="/integracoes?aba=calendarios"
                      className="rounded-control underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                    >
                      Conectar
                    </Link>
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-white/55">
                    {/* Enviando/recebendo em vez de só "conectado": é o que a
                        pessoa quer saber ao marcar um horário. */}
                    {item.error ? "Sincronização precisa de atenção" : describeFlow(item.sending, item.receiving)}
                  </p>
                )}

                {item.error && (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-warn">
                    <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
                    <span>{item.error} Verifique em Integrações.</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function describeFlow(sending: boolean, receiving: boolean): string {
  if (sending && receiving) return "Credenciais salvas · envio e consulta de disponibilidade ativados";
  if (sending) return "Credenciais salvas · envio de horários ativado";
  if (receiving) return "Credenciais salvas · consulta de disponibilidade ativada";
  // Conectado com os dois desligados: a sincronização está pausada nos toggles.
  return "Conectado · sincronização pausada";
}
