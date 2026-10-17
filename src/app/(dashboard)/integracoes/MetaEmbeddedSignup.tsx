"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { requestSave } from "@/components/ui/toast/save-service";
import type { ActionResult } from "@/components/ui/toast/types";
import type { EmbeddedSignupPublicConfig } from "@/modules/whatsapp/embedded-signup-config";
import {
  readEmbeddedSignupEvent,
  type SignupAssets,
} from "@/modules/whatsapp/embedded-signup-events";

type FacebookSdk = {
  init(options: {
    appId: string;
    version: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
  }): void;
  login(
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: {
        setup: Record<string, never>;
        featureType: "whatsapp_business_app_onboarding";
      };
    },
  ): void;
};
const sdk = () => (window as Window & { FB?: FacebookSdk }).FB;
const endpoint = "/api/integrations/meta/signup";
const post = (body: object) =>
  requestSave(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const invalid = (error: string): ActionResult => ({
  ok: false,
  code: "validation",
  error,
});

export function MetaEmbeddedSignup({
  config,
  hasCredentials,
  disabled = false,
}: {
  config: EmbeddedSignupPublicConfig | null;
  hasCredentials: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const feedback = useSaveFeedback({
    entity: "conexão com a Meta",
    gender: "f",
  });
  const [ready, setReady] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [stage, setStage] = useState("");
  const [preparing, setPreparing] = useState(Boolean(config));
  const [canFinish, setCanFinish] = useState(false);
  const finishRef = useRef<{ attemptId: string; assets: SignupAssets } | null>(
    null,
  );
  const disposeRef = useRef<(() => void) | null>(null);
  const run = feedback.run;

  // Preparar antes do clique permite abrir o popup sincronamente com o gesto do usuário.
  useEffect(() => {
    if (!config) return;
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "start" }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (!alive) return;
        if (!response.ok || typeof body?.attemptId !== "string") {
          await run(async () => ({
            ok: false,
            code:
              response.status === 401
                ? "auth"
                : response.status === 403
                  ? "forbidden"
                  : "validation",
            error:
              typeof body?.error === "string"
                ? body.error
                : "Não foi possível preparar a conexão. Atualize a página e tente novamente.",
          }));
        } else setAttemptId(body.attemptId);
      } catch {
        if (alive) await run(async () => ({ ok: false, code: "network" }));
      } finally {
        if (alive) setPreparing(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [config, revision, run]);

  useEffect(() => () => disposeRef.current?.(), []);

  function launch(): Promise<ActionResult> {
    const facebook = sdk();
    if (!config || !facebook || !attemptId)
      return Promise.resolve(
        invalid("Recomece para preparar uma nova autorização."),
      );
    return new Promise((resolve) => {
      let assets: SignupAssets | null = null;
      let authorized = false,
        finishing = false,
        settled = false,
        codeReceived = false;
      const complete = (result: ActionResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener("message", listener);
        disposeRef.current = null;
        resolve(result);
      };
      const finish = () => {
        if (!assets || !authorized || finishing || settled) return;
        finishing = true;
        const selection = { attemptId, assets };
        finishRef.current = selection;
        setCanFinish(true);
        setStage("Conferindo o número e concluindo a conexão…");
        void post({ step: "finish", attemptId, ...assets })
          .then(complete)
          .catch(() => complete({ ok: false, code: "network" }));
      };
      const listener = (event: MessageEvent) => {
        const parsed = readEmbeddedSignupEvent(event.origin, event.data);
        if (!parsed || settled) return;
        if (parsed.kind === "finish") {
          assets = parsed.assets;
          finish();
        } else
          complete(
            invalid(
              parsed.kind === "cancel"
                ? "Conexão cancelada. Recomece quando estiver com o celular disponível."
                : "A Meta não concluiu a autorização. Recomece a conexão.",
            ),
          );
      };
      const timeout = window.setTimeout(
        () =>
          complete(
            invalid("O tempo de autorização terminou. Recomece a conexão."),
          ),
        10 * 60_000,
      );
      disposeRef.current = () =>
        complete(
          invalid("A conexão foi interrompida. Recomece a autorização."),
        );
      window.addEventListener("message", listener);
      setStage(
        "Na janela da Meta, escolha o número e confirme no WhatsApp Business do celular.",
      );
      try {
        facebook.login(
          (response) => {
            if (settled || codeReceived) return;
            const code = response.authResponse?.code;
            if (!code) {
              complete(
                invalid(
                  "A janela foi fechada sem autorização. Permita pop-ups para este site e recomece.",
                ),
              );
              return;
            }
            codeReceived = true;
            setStage("Validando sua autorização…");
            // Não esperar o postMessage: o código expira em 30 segundos.
            void post({ step: "authorize", attemptId, code })
              .then((result) => {
                if (!result.ok) complete(result);
                else {
                  authorized = true;
                  finish();
                }
              })
              .catch(() => complete({ ok: false, code: "network" }));
          },
          {
            config_id: config.configId,
            response_type: "code",
            override_default_response_type: true,
            extras: {
              setup: {},
              featureType: "whatsapp_business_app_onboarding",
            },
          },
        );
      } catch {
        complete(
          invalid(
            "Não foi possível abrir a Meta. Permita pop-ups para este site e recomece.",
          ),
        );
      }
    });
  }

  function connect() {
    void feedback.run(async () => {
      const saved = finishRef.current;
      const result = saved
        ? await post({
            step: "finish",
            attemptId: saved.attemptId,
            ...saved.assets,
          })
        : await launch();
      setStage("");
      if (result.ok) {
        finishRef.current = null;
        setCanFinish(false);
        setAttemptId(null);
        router.refresh();
      }
      return result;
    });
  }

  return (
    <div className="space-y-4 rounded-control border border-iris/30 bg-iris/[0.06] p-4">
      <div>
        <p className="font-medium text-white">
          Conectar com seu WhatsApp Business
        </p>
        <p className="mt-1 max-w-prose text-sm text-white/60">
          Autorize pela janela oficial da Meta e confirme no celular. Seu número
          continua no aplicativo WhatsApp Business. Use um número diferente do
          conectado por QR code ao Fechai.
        </p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-white/70">
        <li>Clique em conectar e entre na Meta com acesso à empresa.</li>
        <li>
          Escolha conectar seu WhatsApp Business existente e confira o número.
        </li>
        <li>
          No celular desse número, abra a mensagem oficial e confirme a conexão.
        </li>
      </ol>
      <p className="text-xs text-white/55">
        As novas mensagens entram no Fechai após a conexão. O histórico antigo
        continua no celular. A Meta poderá pedir para vincular novamente os
        dispositivos adicionais.
      </p>
      {config ? (
        <>
          <Script
            id="meta-embedded-signup-sdk"
            src="https://connect.facebook.net/en_US/sdk.js"
            strategy="afterInteractive"
            onReady={() => {
              try {
                sdk()?.init({
                  appId: config.appId,
                  version: config.version,
                  autoLogAppEvents: false,
                  xfbml: false,
                });
                setReady(Boolean(sdk()));
              } catch {
                void run(async () =>
                  invalid(
                    "Não foi possível carregar a Meta. Atualize a página.",
                  ),
                );
              }
            }}
            onError={() =>
              void run(async () =>
                invalid(
                  "Não foi possível carregar a Meta. Confira se o navegador está bloqueando a conexão e atualize a página.",
                ),
              )
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={connect}
              loading={feedback.saving || preparing}
              loadingLabel={stage || "Preparando conexão"}
              aria-label={
                canFinish
                  ? "Concluir conexão"
                  : hasCredentials
                    ? "Refazer conexão pela Meta"
                    : "Conectar com a Meta"
              }
              disabled={disabled || !ready || !attemptId}
            >
              {canFinish
                ? "Concluir conexão"
                : hasCredentials
                  ? "Refazer conexão pela Meta"
                  : "Conectar com a Meta"}
            </Button>
            {!feedback.saving && (
              <Button
                type="button"
                variant="ghost"
                disabled={preparing || disabled}
                onClick={() => {
                  finishRef.current = null;
                  setCanFinish(false);
                  setPreparing(true);
                  setAttemptId(null);
                  setStage("");
                  setRevision((n) => n + 1);
                }}
              >
                Recomeçar
              </Button>
            )}
            {feedback.saving && (
              <Button
                type="button"
                variant="ghost"
                disabled={canFinish}
                onClick={() => disposeRef.current?.()}
              >
                Cancelar
              </Button>
            )}
          </div>
          {stage && (
            <p role="status" className="text-sm text-white/70">
              {stage}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-white/70">
          A equipe do Fechai precisa habilitar esta opção na Meta antes de você
          conectar por aqui.
        </p>
      )}
    </div>
  );
}
