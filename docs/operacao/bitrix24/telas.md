# Bitrix24 — Telas

O `BitrixCard` fica em `/integracoes?aba=crm` e oferece conexão pelo webhook de entrada do portal, escolha de responsável, envio de leads e envio de agendamentos. Com a conexão ativa, contatos sempre entram no fluxo de envio.

O card reúne estado, contagens, avisos e controles para testar, pausar, retomar, desconectar e conferir envios. O painel de envios sem confirmação permite procurar o registro no portal e declarar explicitamente que ele está ausente. O formulário usa `UnsavedForm` e feedback via `useActionToast`.

[Página de integrações](../../../src/app/(dashboard)/integracoes/page.tsx) · [Card Bitrix24](../../../src/app/(dashboard)/integracoes/BitrixCard.tsx)
