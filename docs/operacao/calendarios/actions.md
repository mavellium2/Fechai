# Integrações de calendário — Ações

| Provedor | Entradas no painel e execução |
|---|---|
| Todos | `setCalendarFeatureAction` grava a flag por conta. As operações do provedor também respeitam a flag. |
| Google | `/api/integrations/google/connect` e `/api/integrations/google/callback` fazem o OAuth. `setGoogleSyncEnabled` e `disconnectGoogleAction` controlam a conexão. |
| Clinicorp | `connectClinicorpAction` verifica e salva a credencial. `saveClinicorpSettingsAction`, `setClinicorpToggle`, `testClinicorpConnectionAction` e `disconnectClinicorpAction` operam na conta. |
| iCloud | `connectIcloudAction`, `saveIcloudSettingsAction`, `setIcloudToggle`, `testIcloudConnectionAction` e `disconnectIcloudAction` operam na conexão CalDAV. O worker `icloud-calendar` envia, remove e verifica a saúde. |

O cancelamento de um compromisso já espelhado pode limpar o evento externo mesmo com o envio desativado, usando a conexão que ainda tem credenciais. [Ações de integrações](../../../src/app/(dashboard)/integracoes/actions.ts) · [Worker](../../../workers/follow-up-worker/README.md)
