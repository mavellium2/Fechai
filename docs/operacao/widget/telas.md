# Widget do site — Telas

| Local | Comportamento |
|---|---|
| `/integracoes?aba=canais` | `SnippetBox` mostra status, botão de ativar ou desativar e código com opção de copiar. Falta de CDN aparece como aviso. |
| Personalização | O mesmo card permite salvar cor, saudação, imagem ou emoji e formato. O formulário usa `UnsavedForm` e `useActionToast`. |
| Site do cliente | O script instalado monta o botão de chat quando habilitado e usa a origem da API embutida na publicação. |

[Card do widget](../../../src/app/(dashboard)/integracoes/SnippetBox.tsx) · [Script do visitante](../../../src/lib/widget/widget-template.js)
