"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { reconnectMetaWhatsapp, saveMetaWhatsapp } from "./actions";
import { AgentRepliesControl, DisconnectControl } from "./WhatsappControls";

type Props = {
  connected: boolean;
  /** O agente responde por este número; desligado, a Meta fica só para Disparos. */
  agentReplies: boolean;
  encryptionConfigured: boolean;
  hasCredentials: boolean;
  displayPhone: string | null;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  webhookUrl: string;
  verifyToken: string | null;
};

/**
 * A conexão da API oficial da Meta, sozinha no cartão dela: convive com a do QR
 * code, e o que é da conta (agente, grupos, bloqueios) mora no cartão de
 * Atendimento, não aqui.
 */
export function MetaWhatsappConnect(props: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  function reconnect() {
    setError(null);
    setInfo(null);
    start(async () => {
      const result = await reconnectMetaWhatsapp();
      if (!result.ok) setError(result.error ?? "Não foi possível reconectar.");
      else setInfo("Credenciais validadas. O WhatsApp oficial está ativo.");
      router.refresh();
    });
  }

  function submit(formData: FormData) {
    setError(null);
    setInfo(null);
    setWarning(null);
    start(async () => {
      const result = await saveMetaWhatsapp(formData);
      if (!result.ok) setError(result.error ?? "Não foi possível validar as credenciais.");
      else {
        setInfo("Conta validada e conectada à API oficial da Meta.");
        setWarning(result.warning ?? null);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {!props.encryptionConfigured && (
        <Alert tone="warn" title="Criptografia não configurada">
          O servidor precisa de ENCRYPTION_KEY para guardar o token e o App Secret com segurança.
        </Alert>
      )}

      {props.connected ? (
        <div className="space-y-5">
          <div>
            <p className="font-display text-xl font-semibold text-white">
              {props.displayPhone || "Número oficial conectado"}
            </p>
            <p className="mt-1 text-sm text-white/60">
              Conectado diretamente pela WhatsApp Business Platform da Meta.
            </p>
          </div>
          <WebhookSetup {...props} />
        </div>
      ) : props.hasCredentials ? (
        <div className="space-y-5">
          <div>
            <p className="font-display text-lg font-semibold text-white">
              Credenciais oficiais salvas
            </p>
            <p className="mt-1 text-sm text-white/60">
              Revalide o token para voltar a processar mensagens, ou abra a configuração para
              trocar as credenciais.
            </p>
          </div>
          <Button onClick={reconnect} loading={pending} loadingLabel="Validando">
            Reconectar com a Meta
          </Button>
          <details className="rounded-control border border-white/10 p-4">
            <summary className="cursor-pointer text-sm font-medium text-white">
              Trocar credenciais
            </summary>
            <div className="mt-4"><MetaCredentialsForm disabled={pending || !props.encryptionConfigured} action={submit} defaults={props} /></div>
          </details>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="font-display text-lg font-semibold text-white">Credenciais da Meta</p>
            <p className="mt-1 max-w-prose text-sm text-white/60">
              Use um token permanente de usuário do sistema. O token e o App Secret serão
              cifrados antes de entrar no banco.
            </p>
          </div>
          <MetaCredentialsForm disabled={pending || !props.encryptionConfigured} action={submit} defaults={props} />
        </div>
      )}

      <p className="max-w-prose text-sm text-white/55">
        Use um número diferente do conectado por QR code: o mesmo número não atende pelas duas
        conexões ao mesmo tempo. Cada conversa continua pelo número em que o contato escreveu, e
        os Disparos saem por este.
      </p>

      {warning && <Alert tone="warn">{warning}</Alert>}
      <FormFeedback error={error} info={info} />

      <Alert tone="warn" title="Regra da API oficial">
        Texto livre só pode ser enviado dentro da janela de atendimento aberta pelo cliente. Fora
        dela, a Meta exige um template aprovado; follow-ups e lembretes sem template podem ser
        recusados pela plataforma.
      </Alert>

      {props.connected && (
        <>
          <AgentRepliesControl
            provider="meta"
            agentReplies={props.agentReplies}
            className="border-t border-white/10 pt-6"
          />
          <DisconnectControl provider="meta" className="border-t border-white/10 pt-6" />
        </>
      )}
    </div>
  );
}

function MetaCredentialsForm({
  disabled,
  action,
  defaults,
}: {
  disabled: boolean;
  action: (data: FormData) => void;
  defaults: Pick<Props, "phoneNumberId" | "businessAccountId">;
}) {
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Phone Number ID" htmlFor="meta-phone-id" hint="ID numérico mostrado em Configuração da API.">
        <Input id="meta-phone-id" name="phoneNumberId" defaultValue={defaults.phoneNumberId ?? ""} inputMode="numeric" required disabled={disabled} />
      </Field>
      <Field label="WABA ID" htmlFor="meta-waba-id" hint="ID da conta do WhatsApp Business.">
        <Input id="meta-waba-id" name="businessAccountId" defaultValue={defaults.businessAccountId ?? ""} inputMode="numeric" required disabled={disabled} />
      </Field>
      <Field label="Token de acesso permanente" htmlFor="meta-access-token" hint="Crie para um usuário do sistema com acesso ao WhatsApp.">
        <Input id="meta-access-token" name="accessToken" type="password" autoComplete="off" required disabled={disabled} />
      </Field>
      <Field label="App Secret" htmlFor="meta-app-secret" hint="Configurações do app Meta › Básico.">
        <Input id="meta-app-secret" name="appSecret" type="password" autoComplete="off" required disabled={disabled} />
      </Field>
      <div className="md:col-span-2">
        <Button type="submit" disabled={disabled}>Validar e conectar</Button>
      </div>
    </form>
  );
}

function WebhookSetup(props: Pick<Props, "webhookUrl" | "verifyToken" | "phoneNumberId" | "businessAccountId">) {
  return (
    <div className="rounded-control border border-white/10 bg-white/[0.03] p-4">
      <p className="font-medium text-white">Receber mensagens e respostas</p>
      <p className="mt-1 text-sm text-white/60">
        No app da Meta, configure o webhook abaixo e assine o campo <span className="font-mono text-white/80">messages</span>.
      </p>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-white/50">Callback URL</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all text-white/85">{props.webhookUrl}</code>
            <CopyButton value={props.webhookUrl} label="Copiar URL" />
          </dd>
        </div>
        {props.verifyToken && (
          <div>
            <dt className="text-white/50">Verify token</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              <code className="min-w-0 break-all text-white/85">{props.verifyToken}</code>
              <CopyButton value={props.verifyToken} label="Copiar token" />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
