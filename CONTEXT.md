# Escala de Sobreaviso

Ferramenta interna da MT Fintech que responde duas perguntas: *quem está de plantão* e *quanto isso vale*. Este arquivo fixa a linguagem do domínio — é glossário, não especificação.

## Equipe e estrutura

**Equipe**:
Grupo de pessoas que cobre um conjunto próprio de janelas de plantão, com início do dia, vigência e rotação próprios. Uma pessoa pertence a exatamente uma equipe. São três: Sustentação, Infraestrutura e Desenvolvimento.
_Avoid_: Time, squad, célula, **Banking** (nome da equipe de Desenvolvimento na planilha legada)

**Roster**:
As pessoas que compõem uma equipe. Define quem pode ser atribuído a um turno dela e quem pode substituir quem.
_Avoid_: Elenco, membros, lista

**Estrutura**:
A definição base de uma equipe: suas janelas por dia-da-semana, seu início do dia e sua rotação (quando existe). É estável — muda por decisão, não por operação do dia a dia.
_Avoid_: Escala base, padrão, template

**Rotação**:
A regra que determina, sem intervenção humana, quem ocupa cada turno em cada data. Nem toda equipe tem uma; sem rotação, os turnos nascem vagos e são atribuídos à mão.
_Avoid_: Rodízio automático, ciclo

**Escada**:
Forma específica de rotação em que cada pessoa avança uma estação por semana ao longo de uma sequência fixa de posições. É a rotação de fim de semana da sustentação.
_Avoid_: Rodízio, carrossel

**Início do dia**:
A hora em que o dia de uma equipe começa. Determina a qual data pertence um turno que cruza a meia-noite. Na sustentação é 23:00 — por isso a Madrugada das 23:00 pertence ao dia seguinte.
_Avoid_: Corte, virada, handoff

**Vigência**:
O intervalo de datas em que uma equipe existe na escala. Fora dele a equipe não tem dias, não tem turnos e não gera remuneração.
_Avoid_: Período, validade

## Escala e turnos

**Escala**:
Os dias gerados para **uma** equipe dentro da vigência dela, já com atribuições, edições e substituições aplicadas. Sempre pertence a uma equipe — "a escala" sem equipe é ambíguo.
_Avoid_: Calendário, agenda, grade

**Turno**:
Um slot de cobertura num dia: período, horário e duração. Existe como propriedade da equipe mesmo quando ninguém o ocupa.
_Avoid_: Plantão, shift, janela

**Atribuição**:
Quem ocupa um determinado turno numa determinada data. Vem da rotação ou da mão do admin. Um turno pode ter mais de uma pessoa.
_Avoid_: Escalação, alocação

**Slot vago**:
Turno sem atribuição — a equipe tem cobertura prevista naquele horário e ninguém responde por ela. É diferente de não haver turno.
_Avoid_: Turno vazio, buraco, folga

**Sem cobertura**:
Faixa de horário em que a equipe não tem turno previsto — por decisão, não por esquecimento. A sustentação não cobre o horário comercial; a infraestrutura não cobre a madrugada.
_Avoid_: Buraco, gap, descoberto

**Expediente**:
O horário comercial, em que a equipe está trabalhando normalmente e portanto não há sobreaviso a pagar. Aparece na escala como ausência de turno, nunca como turno de alguém.
_Avoid_: Horário comercial, jornada

**Folga**:
Estado de uma pessoa que está fora da rotação numa determinada semana. É propriedade da pessoa, não do turno; só existe em equipe com rotação.
_Avoid_: Descanso, off

**Edição de escala**:
Alteração pontual feita pelo admin sobre a estrutura — trocar quem cobre, mudar horário, criar turno de feriado, rotular o dia. Vence a substituição quando define pessoas explicitamente.
_Avoid_: Override, exceção, ajuste

**Rótulo do dia**:
Texto livre que o admin associa a uma data para explicar por que ela é atípica (ex.: "Feriado").
_Avoid_: Tag, motivo, observação

## Substituições

**Substituição**:
Acordo em que uma pessoa cobre todos os turnos de outra durante um intervalo de datas. Titular e substituto são sempre da mesma equipe.
_Avoid_: Troca, cobertura, swap

**Titular**:
A pessoa originalmente atribuída ao turno — quem se ausenta.
_Avoid_: Dono, responsável

**Substituto**:
A pessoa que assume os turnos do titular durante a substituição.
_Avoid_: Cobertura, backup

## Controle de horas

**Controle de Horas**:
O lado financeiro do produto: converte plantões e lançamentos manuais em valor a receber.
_Avoid_: CH por extenso em texto de usuário, folha, timesheet

**Sobreaviso**:
Tipo de remuneração pago a 1/3 do valor da hora pelo tempo em que a pessoa fica disponível. Nunca usar como sinônimo de turno ou de plantão.
_Avoid_: Plantão, standby, on-call

**Hora Extra**:
Tipo de remuneração pago a 150% do valor da hora pelo tempo efetivamente trabalhado.
_Avoid_: HE em texto de usuário, overtime

**Compensação**:
Tipo de lançamento que abate valor da nota — tempo já compensado de outra forma. Usa o mesmo fator do sobreaviso.
_Avoid_: Banco de horas, desconto

**Lançamento**:
Um registro de horas de um tipo, numa data, com início e fim. Pode vir da escala (sobreaviso) ou da mão da pessoa (hora extra, compensação).
_Avoid_: Entrada, apontamento, registro

**Fechamento**:
Ato do admin que congela um mês de uma pessoa num retrato imutável. Depois dele, os valores daquele mês param de ser recalculados.
_Avoid_: Trava, lock, consolidação

**Valor da NF**:
O total a receber no mês: remuneração mais sobreaviso mais hora extra menos compensação.
_Avoid_: Total, líquido, pagamento

## Acesso

**Allowlist**:
A lista que decide quem é quem: liga um e-mail a uma pessoa, à equipe dela e às equipes que ela administra.
_Avoid_: Whitelist, cadastro, usuários

**Escopo de administração**:
O conjunto de equipes cuja escala e cujo controle de horas uma pessoa pode alterar. Independe da equipe a que ela pertence — há admin que não pertence a equipe nenhuma.
_Avoid_: Permissão, nível de acesso
