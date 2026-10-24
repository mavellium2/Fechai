"use client";

import { startTransition, useActionState, useId, useState } from "react";
import { useActionToast } from "@/components/ui/toast";
import { Plus, ShieldAlert, UserRound } from "lucide-react";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { PLANS } from "@/modules/billing/plans";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectMenu } from "@/components/ui/select-menu";
import { createAccount } from "../../actions";

/**
 * Criação de conta pelo admin, num modal.
 *
 * Era um card que abria no meio da página, empurrando a tabela para baixo —
 * criar uma conta é uma tarefa fechada, com começo e fim, e não convive com a
 * lista. No modal ela vira o assunto inteiro: overlay escurece o resto, o foco
 * fica preso e Esc sai.
 *
 * O gatilho é de quem chama (a barra de ações, ao lado da busca), via
 * `open`/`onOpenChange`. Sem essas props o componente desenha o próprio botão
 * e cuida do estado, como era antes.
 */
export function NewAccountForm({
  open: openProp,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (next: boolean) => {
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  };

  const [state, formAction, pending] = useActionState(createAccount, null);
  useActionToast(state, pending, { entity: "conta", gender: "f", action: "create" });
  const [copyError, setCopyError] = useState<string | null>(null);

  return (
    <>
      {/* Sem controle externo, o componente ainda oferece o próprio gatilho. */}
      {!controlled && (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <Plus size={15} aria-hidden />
          Nova conta
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Criar conta"
        description="Cria o tenant, o usuário e a configuração base — a pessoa já entra usando."
        size="wide"
      >
        {/* Credenciais recém-criadas — só aparecem uma vez */}
        {state?.ok && (
          <Alert tone="success" title={`Conta criada: ${state.email}`} className="mb-5">
            {state.tempPassword ? (
              <>
                <p className="text-white/70">
                  Senha provisória — copie agora, ela não será mostrada de novo.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-black/40 px-3 py-2 font-mono text-sm text-white">
                    {state.tempPassword}
                  </code>
                  <CopyButton
                    value={state.tempPassword}
                    label="Copiar senha"
                    onCopyError={setCopyError}
                  />
                </div>
                {copyError && <p className="mt-2 text-white/70">{copyError}</p>}
              </>
            ) : (
              <p className="text-white/70">Use a senha que você definiu.</p>
            )}
          </Alert>
        )}

        {/*
          A limpeza pós-sucesso era um `useEffect` que chamava `form.reset()` e
          `setRole("OWNER")` — setState dentro de efeito, com renderização em
          cascata. Trocar a `key` remonta o formulário: os campos voltam ao
          `defaultValue` e o estado interno some junto, sem efeito nenhum.
          Em caso de erro a key não muda, então o que a pessoa digitou fica lá.
        */}
        <AccountFields
          key={state?.ok ? `criada-${state.email}` : "rascunho"}
          formAction={formAction}
          pending={pending}
          error={state?.ok ? undefined : state?.error}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

const ROLES = [
  {
    value: "OWNER",
    label: "Cliente",
    badge: "owner do tenant",
  },
  {
    value: "SUPERADMIN",
    label: "Superadmin",
    badge: "painel administrativo",
  },
];

function AccountFields({
  formAction,
  pending,
  error,
  onCancel,
}: {
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  onCancel: () => void;
}) {
  const [role, setRole] = useState("OWNER");
  const [planKey, setPlanKey] = useState("FREE");
  const roleLabelId = useId();
  const planLabelId = useId();

  return (
    <form
      // `action` do React 19 zera os campos ao fim de QUALQUER resultado, erro
      // incluído, e o `key` só cobre o sucesso. Enviar por `onSubmit` mantém o
      // que a pessoa digitou quando a criação é recusada.
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => formAction(new FormData(event.currentTarget)));
      }}
      className="space-y-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nome da conta" htmlFor="na-tenant">
          <Input
            {...fieldProps("na-tenant")}
            name="tenantName"
            required
            placeholder="Ex: Estúdio Aurora"
          />
        </Field>

        <Field label="E-mail de acesso" htmlFor="na-email">
          <Input
            {...fieldProps("na-email")}
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="pessoa@negocio.com.br"
          />
        </Field>

        {/*
          `SelectMenu` no lugar do `<select>`: o menu nativo é desenhado pelo
          sistema e abre claro sobre o modal escuro. Como aqui ele está num
          `<form>` e o controle é um `<button>`, o valor vai no envio por um
          input oculto — é o que a prop `name` faz.

          O rótulo é o `<label>` do `Field` (via `labelledBy`), não um
          `aria-label` repetido: dois nomes fariam o leitor de tela ignorar o
          que está na tela.
        */}
        <div>
          <p id={roleLabelId} className="text-sm font-medium text-white/85">
            Tipo de conta
          </p>
          <div className="mt-2">
            <SelectMenu
              name="role"
              label="Tipo de conta"
              labelledBy={roleLabelId}
              icon={role === "SUPERADMIN" ? ShieldAlert : UserRound}
              value={role}
              onChange={setRole}
              options={ROLES.map((r) => ({
                value: r.value,
                label: r.label,
                badge: r.badge,
              }))}
            />
          </div>
        </div>

        <div>
          <p id={planLabelId} className="text-sm font-medium text-white/85">
            Plano
          </p>
          <div className="mt-2">
            <SelectMenu
              name="planKey"
              label="Plano"
              labelledBy={planLabelId}
              value={planKey}
              onChange={setPlanKey}
              options={PLANS.map((p) => ({
                value: p.key,
                label: p.name,
                badge: `${p.messagesPerMonth.toLocaleString("pt-BR")} msg`,
              }))}
            />
          </div>
        </div>
      </div>

      <Field
        label="Senha"
        htmlFor="na-password"
        hint="Deixe vazio para gerar uma senha provisória."
        optional
      >
        <Input
          {...fieldProps("na-password", { hint: true })}
          name="password"
          type="text"
          autoComplete="new-password"
          placeholder={`mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
        />
      </Field>

      {role === "SUPERADMIN" && (
        <Alert tone="warn">
          Superadmin enxerga e altera todas as contas da plataforma, incluindo planos e suspensões.
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {/* Ações no fim do formulário, com a primária à direita: é a ordem de
          leitura de um diálogo, e "Cancelar" precisa existir além do X. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
        <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/45">
          a pessoa entra por /login
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={pending} loadingLabel="Criando conta">
            Criar conta
          </Button>
        </div>
      </div>
    </form>
  );
}
