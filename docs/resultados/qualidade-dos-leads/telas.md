# Qualidade dos leads — Telas

| Tela | Componente | Comportamento |
| --- | --- | --- |
| `/relatorios?visao=leads` | `LeadQualityView` | Período compartilhado com o Operacional, cobertura de cidade, área, dúvidas, perdas e desfechos. |
| `/configuracoes` | `ServiceAreaForm` | Configura cidade-base e lista de municípios atendidos. |
| `/relatorios?visao=mensal` | Documento e evidências do mês | Usa os agregados congelados na competência. O bloco depende de haver leads na base publicada. |

O painel explica a cobertura ao lado do percentual. Nas leituras atuais sem origem de aquisição, a população inclui contatos antigos e abordados pela clínica. A visualização preserva essa ausência de origem e omite sugestões de tráfego.

[Mapa da área de relatórios](../../../src/app/(dashboard)/relatorios/README.md) · [Relatório mensal](../relatorio-mensal/_index.md)
