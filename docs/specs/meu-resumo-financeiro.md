# Spec — Meu Resumo Financeiro

Estado: aprovada, não implementada.

Esta é a versão pessoal e simplificada da visão de custos do Relatório
Consolidado. O vocabulário de domínio está em [CONTEXT.md](../../CONTEXT.md) e
a visão administrativa permanece descrita em
[relatorio-consolidado-custo.md](./relatorio-consolidado-custo.md).

## Objetivo

Permitir que uma pessoa autenticada consulte seus próprios custos e horas em
uma visão visual, histórica e simples, reaproveitando a camada financeira e os
padrões visuais da visão administrativa sem expor dados de colegas.

A visão deve responder rapidamente:

- Quanto foi o custo da própria cobertura no mês?
- Quantas Horas de Sobreaviso e Horas Extras foram contabilizadas?
- O que está realizado, pendente ou rejeitado?
- Como os valores próprios evoluíram nos últimos meses?

## Identidade e navegação

- O nome exibido é **Meu Resumo Financeiro**.
- A visão aparece em uma aba própria.
- A aba só aparece quando o perfil autenticado possui `memberId`.
- A visão administrativa continua separada dentro do Controle de Horas.
- Um administrador que também possui `memberId` pode acessar seu resumo pessoal.
- Usuário sem `memberId` não pode selecionar manualmente outra pessoa para
  preencher a visão.

## Acesso e privacidade

- O usuário comum vê somente os dados associados ao próprio `memberId`.
- A equipe da pessoa aparece apenas como contexto informativo.
- Não há filtro, comparação ou navegação para outras equipes ou pessoas.
- O backend deve derivar a pessoa do perfil autenticado.
- Parâmetros informados pelo cliente não podem substituir o `memberId` do
  usuário comum.
- A restrição deve existir no backend e no frontend; filtro visual isolado não
  é controle de acesso.
- Nenhuma exportação pode conter dados de outra pessoa.

## Período

- O mês atual fica em destaque na abertura.
- O histórico máximo é de 12 meses.
- O usuário pode selecionar 6 ou 12 meses.
- O mês atual fica selecionado inicialmente.
- O mês selecionado controla o detalhamento e os indicadores contextuais.
- Competências anteriores ao início da pessoa ou equipe aparecem como sem
  dados, não como custo zero.

## Privacidade financeira

- A remuneração fica oculta por padrão.
- A visão inicial usa Custo Variável:

```text
Custo Variável = Sobreaviso + Hora Extra − Compensação
```

- O usuário pode revelar a remuneração por uma ação explícita.
- Depois de revelar, pode alternar para Custo Mensal:

```text
Custo Mensal = Remuneração + Sobreaviso + Hora Extra − Compensação
```

- O rótulo da visão deve acompanhar a configuração escolhida.
- O termo Valor da NF só deve aparecer quando a remuneração estiver incluída.
- A remuneração volta a ficar oculta ao sair da visão, trocar de competência ou
  recarregar a página.
- A ocultação não pode impedir o acesso às horas e ao Custo Variável.

## Conteúdo da tela

A hierarquia visual deve ser:

1. Resumo da competência atual.
2. Gráfico histórico mensal.
3. Detalhamento da competência selecionada.
4. Lançamentos individuais em seção recolhível.

Indicadores do resumo:

- Custo Variável ou Custo Mensal, conforme a configuração.
- Horas de Sobreaviso.
- Horas Extras.
- Compensação.
- Pendências de Hora Extra.
- Estado da competência.

## Gráfico

- O gráfico representa somente a pessoa autenticada.
- O eixo permanece mensal, limitado ao período selecionado.
- Com remuneração oculta, a composição representa Custo Variável.
- Com remuneração revelada, a composição mostra Remuneração, Sobreaviso,
  Hora Extra e Compensação.
- Compensação aparece como abatimento.
- Valores devem permanecer legíveis sem depender exclusivamente de hover.
- O mês selecionado deve ser visualmente identificável.
- Não há séries por equipe ou por pessoa.

## Situações de Hora Extra

- Realizado é a situação inicial.
- Pendente e Rejeitado podem ser consultados por filtro.
- Hora Extra pendente ou rejeitada nunca entra no realizado.
- Pendências exibem horas e valor potencial separadamente.
- O usuário não pode aprovar ou rejeitar lançamentos nesta visão.
- O detalhamento e as exportações devem refletir a situação selecionada sem
  apresentar valores realizados como se fossem potenciais.

## Detalhamento

O detalhamento da competência selecionada contém:

- Pessoa autenticada.
- Equipe de contexto.
- Remuneração, quando revelada.
- Sobreaviso.
- Hora Extra.
- Compensação.
- Custo correspondente à visão selecionada.
- Horas de Sobreaviso.
- Horas Extras.
- Situação da Hora Extra.
- Estado e origem do dado.

Os lançamentos individuais podem ser consultados em uma seção recolhível,
sem oferecer ações administrativas ou edição.

## Estados

A visão deve distinguir:

- Carregando.
- Erro ao carregar.
- Sem dados no período.
- Sem atividade no mês.
- Fechado, baseado em snapshot.
- Em aberto, recalculado.
- Estimado.
- Snapshot incompleto.
- Hora Extra pendente.
- Hora Extra rejeitada.

As mensagens são orientadas à pessoa e não devem expor detalhes internos como
`adminOf`, permissões administrativas ou estruturas de autorização.

## Exportações

### CSV pessoal

- A visão possui uma exportação própria e simplificada.
- Contém somente os dados da pessoa autenticada.
- Respeita período, competência, situação e visibilidade da remuneração.
- Deve identificar estado e origem dos dados.
- Não inclui dados de equipes ou pessoas externas.
- Não substitui nem altera o CSV existente do Controle de Horas.
- O CSV existente mantém seu cabeçalho, colunas, separador, aspas, BOM, CRLF
  e nome de arquivo atuais.

### PDF ou impressão

- A visão possui exportação própria para PDF ou impressão.
- Inclui resumo, gráfico e detalhamento da competência selecionada.
- Respeita a visibilidade da remuneração.
- Não inclui controles administrativos nem dados de terceiros.
- Deve manter legibilidade em página impressa, incluindo todas as colunas do
  detalhamento pessoal.

## Ações fora do escopo

- Aprovar ou rejeitar Hora Extra.
- Editar lançamentos.
- Alterar remuneração.
- Alterar escala ou substituições.
- Consultar colegas.
- Comparar equipes.
- Filtrar equipes ou pessoas.
- Criar uma nova entidade de setor.
- Alterar fórmulas financeiras.
- Criar previsão de custos.
- Expandir o histórico além de 12 meses.

## Responsabilidades de implementação

- Reutilizar a camada financeira da visão administrativa sem duplicar fórmulas.
- Reutilizar padrões visuais, estados e componentes quando isso não ampliar o
  escopo de acesso.
- Adaptar o carregamento de dados para o `memberId` autenticado.
- Garantir que a autorização no backend não dependa do filtro enviado pelo
  cliente.
- Manter exportações pessoais separadas das exportações administrativas e do
  CSV antigo do Controle de Horas.
- Não alterar o comportamento da visão administrativa existente.

## Critérios de aceite

1. A aba Meu Resumo Financeiro só aparece para perfis com `memberId`.
2. Usuário comum nunca consegue consultar dados de outro membro.
3. Administrador com `memberId` consegue consultar seu próprio resumo pessoal.
4. O mês atual aparece destacado na abertura.
5. O histórico permite no máximo 12 meses.
6. A remuneração inicia oculta.
7. O custo inicial é o Custo Variável.
8. Revelar remuneração permite alternar para Custo Mensal.
9. Realizado, Pendente e Rejeitado são diferenciados.
10. Pendências não contaminam o realizado.
11. Fechado, Em aberto, Estimado e Sem dados são identificados.
12. O detalhamento corresponde à pessoa e competência selecionadas.
13. CSV e PDF respeitam o escopo pessoal e a visibilidade da remuneração.
14. O CSV antigo do Controle de Horas permanece inalterado.
15. A visão não oferece ações administrativas ou edição.
16. Existe alternativa tabular acessível e funcionamento responsivo.
