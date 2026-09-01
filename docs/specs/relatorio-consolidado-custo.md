# Spec — Visão de custo do relatório consolidado

Estado: aprovada, não implementada.

Vocabulário de domínio em [CONTEXT.md](../../CONTEXT.md). Esta spec descreve a
visão analítica do relatório consolidado; não altera as regras de cálculo do
Controle de Horas.

## Objetivo

Adicionar ao Relatório Consolidado uma visão visual, mensal e filtrável da
Equipe Sustentação, com comparação opcional entre equipes administradas. A
visão deve responder rapidamente:

- Quanto custa a cobertura no período?
- Como esse custo evoluiu mês a mês?
- Quantas Horas de Sobreaviso e Horas Extras foram contabilizadas?
- Quais equipes e pessoas explicam o resultado?

As métricas disponíveis são Custo Mensal, Horas de Sobreaviso e Horas Extras.

## Vocabulário

- **S&S** é apenas um nome informal para a Equipe Sustentação nesta feature.
- **Custo Mensal** é a visão financeira configurável da competência.
- **Valor da NF** é usado quando o Custo Mensal inclui remuneração.
- **Custo Variável** é usado quando a remuneração é excluída.
- **Horas de Sobreaviso** são as horas dos lançamentos de Sobreaviso.
- **Horas Extras** são as horas de Hora Extra contabilizáveis.
- **Realizado** inclui valores fechados por snapshot ou recalculados no mês aberto.
- **Pendente** não compõe o realizado e deve ser apresentado separadamente.

## Acesso e escopo

- A visão fica disponível somente para administradores.
- O conjunto de equipes exibido é limitado a `adminOf`.
- `scheduleEditOf` não concede acesso financeiro.
- Nenhum dado de equipe fora do escopo pode ser exposto por filtro, gráfico,
  detalhamento, CSV ou PDF.
- A seleção inicial contém somente a Equipe Sustentação.
- As demais equipes do escopo podem ser adicionadas para comparação.

## Filtros

Filtros disponíveis:

- Intervalo de competências.
- Equipes.
- Pessoas.
- Métrica.
- Situação dos lançamentos.
- Inclusão ou exclusão de remuneração na visão de custo.

Valores iniciais:

- Período: últimos 12 meses.
- Equipe: Sustentação.
- Pessoas: todas.
- Métrica: Custo Mensal.
- Situação: Realizado.
- Mês selecionado: o último mês do intervalo.
- Remuneração: incluída.

Alterar filtros deve atualizar o gráfico, indicadores, detalhamento e
exportações de maneira consistente.

## Métricas e regras de cálculo

### Custo Mensal

Com remuneração incluída:

```text
Custo Mensal = Remuneração + Sobreaviso + Hora Extra − Compensação
```

Quando o usuário excluir remuneração:

```text
Custo Variável = Sobreaviso + Hora Extra − Compensação
```

O rótulo da métrica deve refletir a configuração. O termo Valor da NF não
deve aparecer quando a remuneração estiver excluída.

### Horas de Sobreaviso

Total de horas dos lançamentos de Sobreaviso atribuídos no período, agregadas
por mês, equipe e pessoa conforme os filtros.

### Horas Extras

Total de horas de Hora Extra contabilizáveis no período. Horas pendentes e
rejeitadas não entram no total realizado.

### Arredondamento

O gráfico e o detalhamento devem preservar o arredondamento financeiro e de
horas já usado pelo Relatório Consolidado: cada linha é arredondada antes da
soma agregada.

## Gráfico

O gráfico mantém o eixo mensal e troca a composição conforme a métrica.

### Custo com uma equipe selecionada

- Usar colunas mensais empilhadas.
- Exibir Remuneração, Sobreaviso, Hora Extra e Compensação.
- Representar Compensação como abatimento, não como custo positivo.
- Exibir o total da coluna de forma explícita.
- Usar cores próprias para os componentes financeiros.

### Custo com várias equipes selecionadas

- Priorizar comparação entre equipes.
- Usar colunas mensais agrupadas por equipe.
- Usar uma cor distinta por equipe.
- Mostrar a composição por componente no tooltip e no detalhamento da equipe
  ou mês selecionado.

### Horas de Sobreaviso e Horas Extras

- Usar colunas mensais agrupadas por equipe.
- Usar uma série por equipe selecionada.
- Exibir unidade e total no tooltip e no resumo textual.

### Interação

- Selecionar uma competência pelo gráfico.
- Selecionar uma equipe pelo gráfico ou legenda.
- Atualizar o detalhamento conforme a seleção.
- Permitir remover ou adicionar séries pela seleção de equipes.
- Não depender de hover para acessar informação essencial.

## Indicadores auxiliares

Exibir indicadores compactos para:

- Custo do período.
- Custo do mês selecionado.
- Horas de Sobreaviso.
- Horas Extras.

Quando existirem pendências, exibir um alerta contextual com a quantidade de
horas e/ou valor potencial pendente, sem somá-lo ao realizado.

## Detalhamento

Ao selecionar uma competência, equipe ou ponto do gráfico, exibir uma tabela
ou painel na própria tela com:

- Pessoa.
- Equipe.
- Remuneração, quando incluída.
- Sobreaviso.
- Hora Extra.
- Compensação.
- Custo resultante.
- Horas de Sobreaviso.
- Horas Extras.
- Situação da Hora Extra.
- Estado do dado: Fechado, Em aberto ou Estimado.
- Origem do valor quando necessário para rastreabilidade.

Pessoas pertencentes ao roster filtrado devem continuar visíveis mesmo sem
atividade, com estado de ausência de dados ou valores zerados conforme o
contexto.

## Estados dos dados

A interface deve distinguir explicitamente:

- Carregando.
- Erro ao carregar.
- Sem equipes administradas.
- Sem dados para o período.
- Sem atividade no mês.
- Mês Fechado, baseado em snapshot.
- Mês Em aberto, recalculado.
- Valor Estimado, quando a remuneração atual for usada para um período sem
  remuneração historicamente confiável.
- Pendências de Hora Extra.
- Ajustes locais não persistidos, que não são refletidos na visão oficial.

Falha de uma fonte de dados nunca deve ser convertida em gráfico zerado ou
interpretada como ausência real de atividade.

## Fechamento e histórico

- Competências fechadas usam o snapshot imutável.
- A competência aberta usa os dados recalculados atuais.
- A origem do valor deve ser indicada visualmente.
- Remuneração armazenada no snapshot é oficial para a competência.
- Remuneração atual aplicada a uma competência histórica sem snapshot deve ser
  marcada como estimada.
- Meses anteriores ao início da vigência de uma equipe aparecem como sem
  dados, não como custo zero.

## Pendências e ajustes

- Realizado é o estado padrão.
- Hora Extra pendente pode ser consultada por filtro ou detalhe, mas não entra
  no realizado.
- Hora Extra rejeitada fica fora do realizado e pode ser identificada no
  detalhamento quando disponível.
- Ajustes manuais não persistidos ficam fora do gráfico, indicadores, CSV e
  PDF.
- Se houver ajustes locais na tela atual, mostrar aviso de que eles não estão
  refletidos na visão consolidada oficial.

## Exportação

### CSV

A exportação CSV filtrada é obrigatória.

- Respeitar todos os filtros ativos.
- Conter os mesmos valores exibidos no gráfico e detalhamento.
- Incluir período, equipes, pessoas, métrica, situação e configuração de
  remuneração.
- Identificar meses fechados, abertos e estimados.
- Não incluir ajustes locais não persistidos.
- Manter o padrão de CSV já usado pelo relatório consolidado.

### PDF

A exportação PDF é desejável e condicionada à viabilidade técnica.

- Permitir exportar o gráfico atual.
- Permitir exportar um relatório completo com as três métricas.
- Aplicar os filtros ativos.
- Incluir período, equipes, estado dos dados e detalhamento selecionado.
- Incluir os indicadores e a legenda necessários para interpretar o gráfico.
- Não incluir ajustes locais não persistidos.

Se a geração de PDF não for confiável, oferecer uma versão imprimível
equivalente e manter o CSV filtrado como saída obrigatória.

## Acessibilidade e responsividade

- Disponibilizar resumo textual dos indicadores e da seleção atual.
- Manter uma tabela acessível sincronizada com o gráfico.
- Permitir navegação por teclado nas métricas, filtros, legenda e seleções.
- Não usar apenas cor para comunicar equipe, componente ou estado.
- Usar `role="status"` para carregamento e `role="alert"` para erros e avisos
  relevantes.
- Preservar contraste WCAG AA.
- No mobile, empilhar indicadores e detalhamento.
- Permitir rolagem horizontal do gráfico quando o intervalo exigir.
- Manter alvos de toque de pelo menos 44 px.
- Respeitar `prefers-reduced-motion`.

## Critérios de aceite

1. Um administrador vê a visão somente com equipes do próprio `adminOf`.
2. A abertura inicial mostra Sustentação, últimos 12 meses, Custo Mensal,
   realizado e remuneração incluída.
3. O usuário consegue alternar entre Custo Mensal, Horas de Sobreaviso e
   Horas Extras.
4. O usuário consegue incluir ou excluir remuneração e recebe rótulo coerente
   com a escolha.
5. Com uma equipe selecionada, o custo mostra a composição financeira por
   componente.
6. Com várias equipes selecionadas, o custo permite comparar equipes por mês.
7. A seleção de mês e equipe atualiza os indicadores e o detalhamento.
8. HE pendente e rejeitada não entram no realizado.
9. O mês fechado usa snapshot e o mês aberto é identificado como recalculado.
10. Valores históricos estimados são identificados como estimados.
11. Erros de carregamento não aparecem como valores zerados.
12. CSV filtrado reproduz os dados visíveis na tela.
13. PDF atual ou completo respeita os filtros, quando tecnicamente disponível.
14. Existe alternativa textual e tabular acessível ao gráfico.
15. Pessoas sem atividade e meses sem dados são diferenciados visualmente.

## Fora do escopo

- Criar uma entidade ou setor S&S.
- Alterar as fórmulas do Controle de Horas.
- Incluir HE pendente no Custo Mensal realizado.
- Persistir ajustes manuais.
- Criar previsão ou projeção de custos.
- Reestruturar equipes, roster ou permissões.
- Tornar `scheduleEditOf` uma autorização financeira.

## Dependências e riscos para implementação

- Validar que snapshots fechados disponibilizam Remuneração, Sobreaviso, Hora
  Extra e Compensação. Ausência de qualquer componente deve ser tratada como
  dado indisponível, nunca como zero silencioso.
- Validar como identificar remuneração oficial versus remuneração atual
  aplicada retrospectivamente.
- Garantir que a agregação preserve o arredondamento por linha do relatório
  atual.
- Validar a solução de geração de PDF no ambiente atual antes de torná-la
  requisito obrigatório.
- Manter consistência entre gráfico, tabela existente, CSV e PDF.
