-- CRM: as tabelas novas (espera de transbordo, histórico de etapas, responsáveis)
-- apontam para o lead e a conversa pela chave composta (tenantId, id), que
-- amarra a linha à conta. Em banco com leads e conversas, o db push recusaria
-- criar esses índices únicos sem --accept-data-loss. Como `id` já é único,
-- (tenantId, id) nunca tem duplicata: criar aqui antes é seguro, e o db push
-- conclui o resto do schema e continua recusando mudanças de risco.
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('"Lead"') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "Lead_tenantId_id_key" ON "Lead" ("tenantId", "id");
  END IF;
  IF to_regclass('"Conversation"') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_tenantId_id_key" ON "Conversation" ("tenantId", "id");
  END IF;
END;
$$;
