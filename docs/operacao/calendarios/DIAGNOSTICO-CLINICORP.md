# Diagnóstico da pendência no Clinicorp — 29/09/2026

## Conclusão

O teste foi salvo na agenda do Fechai, mas a integração não reconheceu uma confirmação válida de criação no Clinicorp. A causa externa exata não pode ser recuperada do arquivo enviado: a resposta dessa operação não foi registrada nos logs.

O aviso observado no painel corresponde, no código local, à validação posterior a uma resposta HTTP bem-sucedida. Ela exige um `id`/`Id` positivo, numérico e seguro e, quando há `Status`, que ele seja `CREATED`. A mensagem observada não tinha o complemento de status, portanto não revela um status explícito de recusa. Corpo vazio, lista vazia, formato diferente ou identificador inválido são possibilidades; os logs não distinguem essas possibilidades. Isso não confirma nem descarta que a operação tenha sido aceita externamente.

## Evidências do arquivo enviado

Arquivo analisado: `fechai-logs.txt`, 21.939.668 bytes. A busca foi feita no arquivo inteiro, preservando uma cópia temporária durante a análise. Não foram reproduzidos dados de pacientes nem credenciais neste documento.

- Nenhuma ocorrência de `[clinicorp] criar agendamento falhou`, da mensagem de criação não confirmada, do nome de teste ou do endpoint `create_appointment_by_api`.
- O worker conseguiu consultar a agenda perto do teste: em **29/09, 11h29min59s**, registrou 79 consultas; em **11h34min59s**, 78 consultas. São os horários locais de Brasília, convertidos dos registros UTC, linhas 1532 e 1543 do arquivo. Esses registros demonstram leitura naquele período, não confirmação de criação.
- O `web-blue` contém apenas 13 linhas de inicialização, entre 08h44min28s e 08h44min32s. O `web-green` contém 185 linhas, de 08h12min31s até seu encerramento às 08h44min44s. Não há resposta de criação a comparar com um envio anterior bem-sucedido.
- Existem erros de esquema do banco às 08h12–08h14 (`MonthlyRoiReport.featuredCase`, `Message.audioSeconds` e `KnowledgeGap`). São anteriores ao teste e referentes a outras operações; não demonstram a causa desta pendência. Há também uma falha de autenticação do PostgreSQL às 08h29, sem vínculo demonstrado com o envio ao Clinicorp.

## Diferença relevante entre o teste e pacientes reais

No código local, o chat de teste envia o nome fixo `TESTE fechai (chat de teste do agente)` e omite **telefone e identificador do paciente**, além de pular a busca/criação de paciente. Essa mudança entrou no histórico em **16/09**, commit `585700c`. Assim, o teste não reproduz o mesmo envio de um paciente real já cadastrado. A ausência desses campos é uma hipótese a investigar, não uma causa comprovada.

A exigência de confirmação com identificador válido existe desde **09/09**, commit `6afe3b4`; o histórico não sustenta atribuí-la a uma mudança recente. As datas do repositório não comprovam a data de implantação de cada versão em produção.

O telefone do teste não foi enviado, portanto o `+55` não explica essa tentativa segundo o fluxo local. A normalização de telefone dos pacientes reais continua sendo uma pendência separada.

## Por que o log não explica a resposta

No código anterior à correção, em `src/modules/scheduling/clinicorp.ts`, `call()` transforma um corpo HTTP vazio em `data: null`. Na função `pushAppointmentToClinicorp()`, o ramo de resposta sem confirmação gravava apenas o aviso genérico em `lastError`, sem registrar o conteúdo ou a estrutura recebida. Esse caminho explica a ausência de erro no console e impede identificar retrospectivamente a resposta externa.

## Próximo passo necessário

Registrar, para uma tentativa controlada futura, o código HTTP, o formato da resposta, os campos de confirmação e a presença dos campos de paciente enviados, com dados pessoais e credenciais protegidos. Se o Clinicorp tiver registro da requisição anterior, consultá-lo evita uma nova criação. Antes de qualquer nova tentativa, conferir o horário na agenda externa para evitar duplicidade. Nenhum agendamento foi reenviado, cancelado ou alterado durante esta análise; nenhuma mudança foi implantada.

## Correção preparada após consultar a documentação oficial

Em 29/09/2026, o código local foi ajustado:

- Procedimento/tipo e observações da consulta são enviados em `Procedures`, campo documentado de criação de agendamento, em vez de `Notes`.
- Busca, cadastro de paciente e agendamento usam o mesmo telefone com DDD sem código brasileiro `55`; um DDD 55 legítimo é preservado. O contato no Fechai não é alterado.
- Quando `/patient/create` retorna os dados sem ID, uma consulta posterior pelo mesmo telefone obtém `PatientId`. Não há repetição de criação; busca que falhou não cria outro paciente.
- Resposta de criação sem confirmação preserva a mensagem devolvida pela API no painel e gera um diagnóstico de estrutura sem expor valores pessoais ou credenciais nos logs.
- A descrição da ferramenta orienta registrar o procedimento/queixa na consulta mesmo quando o tipo é “avaliação”. É orientação para o agente; ainda precisa de validação do comportamento em produção.

Referências: [criação de agendamento](https://api.clinicorp.com/api-docs/#/appointment/post_appointment_create_appointment_by_api), [criação de paciente](https://api.clinicorp.com/api-docs/#/patient/post_patient_create), [consulta de paciente](https://api.clinicorp.com/api-docs/#/patient/get_patient_get).

As incompatibilidades foram corrigidas no repositório local. Elas não demonstram qual delas causou a tentativa histórica, cuja resposta não foi registrada. A correção ainda não foi implantada nem validada com nova criação em produção.

Validação local: **166 testes passaram em cinco arquivos** (envio e ações do Clinicorp, tools de agendamento, lembretes do Clinicorp e pulso da agenda). ESLint dos arquivos alterados e `git diff --check` passaram. As chamadas de API e banco desses testes são simuladas.
