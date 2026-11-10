"use client";

import { useId, useState, useTransition } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { PasswordStrength } from "@/components/ui/password-strength";
import { isStrongPassword } from "@/lib/password";
import { adminChangeUserPassword } from "../../actions";

export type TenantUser = { id: string; email: string; role: string };

/**
 * Troca de senha dos usuários comuns da conta, no painel lateral. Contas de
 * admin não aparecem: a senha delas só muda por `/configuracoes`. Campo vazio
 * gera uma senha provisória, mostrada uma única vez.
 */
export function UserPasswords({ users }: { users: TenantUser[] }) {
  const regular = users.filter((u) => u.role !== "SUPERADMIN");
  const [openId, setOpenId] = useState<string | null>(null);
  if (!regular.length) return null;

  return (
    <section className="border-t border-white/10 pt-5">
      <p className="text-sm font-medium text-white/85">Senha dos usuários</p>
      <p className="mt-1 text-sm text-white/50">
        Defina uma nova senha ou gere uma provisória. A pessoa usa a nova senha no próximo login.
      </p>
      <ul className="mt-3 space-y-2">
        {regular.map((u) => (
          <li key={u.id} className="rounded-control border border-white/10 bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm text-white/85" title={u.email}>
                {u.email}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpenId(openId === u.id ? null : u.id)}
                aria-expanded={openId === u.id}
              >
                <KeyRound size={14} aria-hidden />
                Alterar senha
              </Button>
            </div>
            {openId === u.id && <PasswordForm user={u} onDone={() => setOpenId(null)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PasswordForm({ user, onDone }: { user: TenantUser; onDone: () => void }) {
  const id = useId();
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ temp?: string } | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const invalid = password !== "" && !isStrongPassword(password);

  function save() {
    setError(null);
    start(async () => {
      try {
        const result = await adminChangeUserPassword(user.id, password);
        if (!result.ok) setError(result.error ?? "Não foi possível trocar a senha.");
        else {
          setPassword("");
          setDone({ temp: result.tempPassword });
        }
      } catch {
        setError("Não foi possível trocar a senha. Tente de novo.");
      }
    });
  }

  if (done)
    return (
      <Alert tone="success" title="Senha alterada" className="mt-3">
        {done.temp ? (
          <>
            <p className="text-white/70">
              Senha provisória — copie agora, ela não será mostrada de novo.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-black/40 px-3 py-2 font-mono text-sm text-white">
                {done.temp}
              </code>
              <CopyButton value={done.temp} label="Copiar senha" onCopyError={setCopyError} />
            </div>
            {copyError && <p className="mt-2 text-white/70">{copyError}</p>}
          </>
        ) : (
          <p className="text-white/70">Use a senha que você definiu para avisar a pessoa.</p>
        )}
        <Button size="sm" variant="ghost" className="mt-2" onClick={onDone}>
          Fechar
        </Button>
      </Alert>
    );

  return (
    <div className="mt-3 space-y-2">
      <label htmlFor={id} className="block text-xs text-white/70">
        Nova senha <span className="text-white/45">(deixe vazio para gerar uma provisória)</span>
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={password}
          autoComplete="new-password"
          disabled={pending}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={invalid || undefined}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShow(!show)}
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        >
          {show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        </Button>
      </div>
      <PasswordStrength password={password} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" loading={pending} loadingLabel="Salvando senha" disabled={invalid} onClick={save}>
          {password ? "Salvar senha" : "Gerar senha provisória"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
