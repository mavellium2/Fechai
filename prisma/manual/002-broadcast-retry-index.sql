-- Prepara o índice de reenvio em bancos que já têm destinatários. O db push
-- conclui o resto do schema e continua recusando mudanças de risco.
DO $$
BEGIN
  IF to_regclass('"BroadcastRecipient"') IS NOT NULL THEN
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE "BroadcastRecipient"
      ADD COLUMN IF NOT EXISTS "retryOfRecipientId" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "BroadcastRecipient_retryOfRecipientId_key"
      ON "BroadcastRecipient" ("retryOfRecipientId");
  END IF;
END;
$$;
