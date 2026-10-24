# Scheduling — histórico

Atualize ao alterar o módulo.

### 2026-10-24 — Calendário da Apple (iCloud, CalDAV)

Card cmukfq7t7002f01jw2mrv7nl8, commits 173105e (espelho), 5a3646a (disponibilidade),
23c588b (worker, saúde, /agenda) e 546ce05 (revisão). Senha de app cifrada; evento
com endereço fixo `fechai-<id>.ics`; 412 = já enviado; leitura com falha = não oferece
horário. Eventos do iPhone só leitura na /agenda (título, sem lembrete). Schema
aditivo: db push + generate nos dois processos. Dependências: ical.js, fast-xml-parser.
Detalhe: `src/modules/scheduling/README.md`, seção "Calendário da Apple (iCloud)".

### 2026-10-09 — Aceite dos riscos da Evolution

qr-risk-terms, parser, action/modal, audit e testes. Checkbox/nome/versão
obrigatórios; prova com ator/data/texto do servidor. Sem prova, QR fica off.
Reativar exige novo aceite; cancelar não ativa. Sem schema novo. ad77741
publicado; 1.644 testes/lint/build, UI isolada e teste posterior em produção
passaram. QR real off/sem aceite; runtime, SQL, Clinicorp e sandbox verificados.

### 2026-10-09 — Confirmações QR autorizadas

Claim/recibos, categorias, agenda manual/status, sandbox. Publicação d71d73c:
1.619 testes, SQL real/Clinicorp/sandbox passaram; WhatsApp real não testado.
Schema aditivo db push/client web+worker; QR permaneceu off.

### 2026-09-29 — Público e categorias

Seleção dinâmica nas duas filas/overrides; tipo desconhecido excluído.
