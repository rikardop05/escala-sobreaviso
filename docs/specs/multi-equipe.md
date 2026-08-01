# Spec — Suporte a múltiplas equipes

Estado: aprovada, não implementada. Vocabulário em [CONTEXT.md](../../CONTEXT.md); decisões estruturais em [docs/adr](../adr).

O app suporta hoje uma equipe (sustentação), com a estrutura da escala embutida em constantes. Passa a suportar três, cada uma com blocos de cobertura, início do dia e vigência próprios.

**Fonte da estrutura de infra e desenvolvimento**: planilha operacional `Sobreaviso(Jul-26).csv`, julho/2026 — grade hora × dia, colunas `Banking` e `Infra`. A estrutura abaixo foi derivada dela, não de descrição verbal, e conferida nos quatro fins de semana do mês.

**Princípio operacional**: a estrutura declarada é um ponto de partida, não uma verdade imutável. O admin ajusta retroativamente e o que precisa fechar é o **total do mês** — é o fechamento mensal que congela a verdade, não a estrutura. Isso significa que errar um bloco na definição inicial é barato e recuperável, e que nenhuma decisão desta spec precisa esperar certeza sobre a estrutura.

## Estrutura das três equipes

**Sustentação** — `sustentacao`, início do dia **23:00**

| Dias | Blocos |
|---|---|
| Seg–Sex | `23:00–04:00` (5h) · `04:00–09:00` (5h) · `18:00–23:00` (5h; sexta até 24:00, 6h) |
| Sáb/Dom | `23:00–11:00` (12h) · `11:00–23:00` (12h) |
| Sem cobertura | 09:00–18:00 nos dias úteis |
| Atribuição | Tabela fixa por dia-da-semana (úteis) + escada de 6 semanas (fds) |

**Desenvolvimento** — `desenvolvimento`, início do dia **00:00**

| Dias | Blocos |
|---|---|
| Seg–Sex | `00:00–09:00` (9h) · `18:00–00:00` (6h) |
| Sáb/Dom | `00:00–09:00` (9h) · `09:00–00:00` (15h) |
| Sem cobertura | 09:00–18:00 nos dias úteis (expediente) |
| Atribuição | **Nenhuma rotação** — blocos nascem vagos, admin atribui |

**Infraestrutura** — `infra`, início do dia **00:00**

| Dias | Blocos |
|---|---|
| Seg–Sex | `18:00–00:00` (6h) |
| Sáb/Dom | `09:00–17:00` (8h) · `17:00–00:00` (7h) |
| Sem cobertura | 00:00–09:00 **todos os dias**; 09:00–18:00 nos dias úteis |
| Atribuição | **Nenhuma rotação** — blocos nascem vagos, admin atribui |

Observações extraídas da planilha que sustentam o modelo:

- **Não existe turno de 24h.** O arranjo "oito às oito" é a mesma pessoa pegando dois blocos consecutivos, e não é regra: ocorreu em 11–13/07 e 25–26/07, não ocorreu em 4–6/07 nem em 18–19/07. A unidade é o bloco.
- **A virada da manhã é 09:00**, não 08:00: a linha `8:00` tem agente nos 31 dias e a linha `9:00` é expediente.
- **Não há rodízio.** A sequência de agentes no bloco das 18:00 não repete em ciclo algum ao longo do mês.
- **Trocas no meio de um bloco acontecem** (~5% dos blocos em julho: 07/07 04:00–06:00, 06/07 a partir das 22:00, 25/07 a partir das 16:00). Ver §6.

## Fatos pendentes

Não bloqueiam a Fase 0.

1. **Acentuação de `Jonata`** — a planilha grafa "Jonatã", a lista do roster grafa "Jonata". O identificador é chave de Redis; escolher um e nunca mudar.
2. **`Anselmo` entra na escala?** Assumido como admin puro (`memberId: null`), porque não aparece na grade de julho — ao contrário de `Alberth`, que administra a infra **e** faz plantão nela. Confirmar.
3. **`Luis` e `Pedro` não aparecem na contagem de horas** da planilha de julho, apesar de estarem entre os mais escalados do mês. Não afeta o app, mas afeta a folha de julho que já foi processada.
4. **`Leonardo Menegon` é admin temporário para testes** — remover de `adminOf` quando os testes terminarem.
5. **Backfill de julho/2026 — ✅ RESOLVIDO (Fase 2, decisão do responsável)**: em vez de reconstituir ~150 atribuições de julho a partir de `Sobreaviso(Jul-26).csv`, `startsOn` de infra e desenvolvimento foi movido para `2026-08-01` (`EQUIPES_NOVAS_STARTS_ON` em `src/lib/teams.js`) — julho nunca existiu para essas equipes dentro do app, então não há nada a reconstituir; o CH mostra o mês anterior ao início como estado vazio ("equipe ainda não existia"), não como falha de cobertura.

---

## 1. Modelo

Duas estruturas novas, em `src/lib/teams.js` (arquivo novo; `schedule.js` fica só com o motor).

```js
MEMBERS = {
  'Ricardo': { displayName: 'Ricardo', teamId: 'sustentacao', color, bg },
  'Dante':   { displayName: 'Dante',   teamId: 'desenvolvimento', … },
  …
}
```

### Roster completo

Identificadores seguem a convenção "primeiro nome, sobrenome só quando colide" — daí `Leonardo Matheus` e `Leonardo Menegon`, os dois em Desenvolvimento, que a planilha distinguia só por apelido (`Leozinho` / `Leozão`).

**Desenvolvimento** — `startsOn: '2026-07-01'`

| Identificador | Nome | E-mail | Apelido | Cor / fundo |
|---|---|---|---|---|
| `Luis` | Luis Gustavo | luis.cunha@ | | `#00695C` / `#E0F2F1` |
| `Adalberto` | Adalberto Teshima | adalberto.teshima@ | Teshima | `#0277BD` / `#E1F5FE` |
| `Pedro` | Pedro Wesley | pedro.soares@ | | `#283593` / `#E8EAF6` |
| `Dante` | Dante Escame | dante.escame@ | | `#C62828` / `#FFEBEE` |
| `Leonardo Matheus` | Leonardo Matheus | leonardo.santos@ | Leozinho | `#4E342E` / `#EFEBE9` |
| `Leonardo Menegon` | Leonardo Menegon | leonardo.rodrigues@ | Leozão | `#558B2F` / `#F1F8E9` |
| `Jonata` | Jonata Crepaldi | jonata.gomes@ | | `#827717` / `#F9FBE7` |
| `Ícaro` | Ícaro Gomes | icaro.motta@ | | `#00838F` / `#E0F7FA` |

**Infraestrutura** — `startsOn: '2026-07-01'`

| Identificador | Nome | E-mail | Cor / fundo |
|---|---|---|---|
| `Alberth` | Alberth Souza | alberth.teixeira@ | `#4527A0` / `#EDE7F6` |
| `Gabriel` | Gabriel Pavanelli | gabriel.pavanelli@ | `#BF360C` / `#FBE9E7` |
| `Antonio` | Antonio Carlos | antonio.santos@ | `#424242` / `#F5F5F5` |
| `Diogo` | Diogo de Moraes | diogo.ferrolho@ | `#880E4F` / `#FCE4EC` |
| `Caio` | Caio Ribeiro | caio.rodrigues@ | `#B71C1C` / `#FFEBEE` |

Domínio de todos: `@mtpagamentos.com.br`. Apelidos são documentação — não entram no app em lugar nenhum.

Cores: 13 famílias distintas das 6 já em uso, todas cumprindo AA sobre o fundo claro pareado. Como o calendário mostra uma equipe por vez, pares visualmente próximos entre equipes diferentes (ex.: `Diogo` e `Alice`) não se encontram na mesma tela — só no widget "Agora", com o nome da equipe ao lado.

```js

TEAMS = {
  sustentacao: {
    id, nome: 'Sustentação', dayStart: '23:00',
    startsOn: '2026-06-08', endsOn: null,
    roster: ['Emanoel', 'Marcus Túlio', 'Ricardo', 'Carlos', 'Raul', 'Alice'],
    blocos:  { 1..5: [<3 turnos com dono fixo>] },              // por dia-da-semana
    rotacao: { dows: [0, 6], tipo: 'escada', roster, anchor, change, legado },
  },
  desenvolvimento: {
    id, nome: 'Desenvolvimento', dayStart: '00:00',
    startsOn: '2026-07-01', endsOn: null, roster: [<8 identificadores — ver Roster completo>],
    blocos: {
      1..5: [{ period: 'Madrugada', time: '00:00 – 09:00', dur: '9h' },
             { period: 'Noite',     time: '18:00 – 00:00', dur: '6h' }],
      0, 6: [{ period: 'Madrugada', time: '00:00 – 09:00', dur: '9h' },
             { period: 'Dia',       time: '09:00 – 00:00', dur: '15h' }],
    },
    rotacao: null,
  },
  infra: {
    id, nome: 'Infraestrutura', dayStart: '00:00',
    startsOn: '2026-07-01', endsOn: null, roster: [<5 identificadores — ver Roster completo>],
    blocos: {
      1..5: [{ period: 'Noite', time: '18:00 – 00:00', dur: '6h' }],
      0, 6: [{ period: 'Dia',   time: '09:00 – 17:00', dur: '8h' },
             { period: 'Noite', time: '17:00 – 00:00', dur: '7h' }],
    },
    rotacao: null,
  },
}
```

Regras derivadas:

- **`MEMBERS` é a fonte única de pessoas.** `PEOPLE` e `CH_NAMES` passam a ser derivados dele. A chave é o identificador e precisa ser única entre todas as equipes (ADR-0003).
- **Convenção de identificador**: primeiro nome; primeiro + sobrenome apenas quando houver colisão entre equipes (`'Leonardo Santos'` / `'Leonardo Matheus'`). Nunca apelido, nunca nome completo.
- **Bloco sem dono nasce com `persons: []`.** `shiftPeople()` passa a poder retornar array vazio — invariante nova, todo leitor precisa tratar.
- **`blocos` cobre os sete dias** para equipe sem rotação; para a sustentação cobre só 1–5, porque 0 e 6 vêm da escada.
- **Fora da vigência a equipe não tem dias.** `buildSchedule` recorta `[startsOn, endsOn]` contra `RANGE_START`/`RANGE_END` globais.

### Motor

`buildSchedule(team, overrides, labels)` — assinatura nova; `team` é obrigatório.

`buildOnCallSegments(schedule, dayStart)` — a heurística `idx === 0 && crosses && startMin >= 12*60` some. Regra nova: um turno cujo horário de início é `>= dayStart` (quando `dayStart > 00:00`) pertence ao dia anterior no calendário. Verificado contra os cinco tipos de turno da sustentação (resultado idêntico) e contra os sete blocos de infra e desenvolvimento, todos com `dayStart: '00:00'` (ADR-0002).

`resolveShiftPeople`, `getActiveSub`, `currentOnCall`, `adjacentOnCall` recebem o contexto da equipe. A regra "edição vence substituição" (`personsOverridden`) não muda.

## 2. Persistência

| Chave | Antes | Depois |
|---|---|---|
| Edições de escala | `schedule_overrides` | `team:{teamId}:schedule_overrides` |
| Rótulos de dia | `schedule_labels` | `team:{teamId}:schedule_labels` |
| Substituições | `substitutions` | `team:{teamId}:substitutions` |
| Lançamentos / parâmetros / fechamentos | `member:{memberId}:ch_*` | **inalterado** |

O backup por `SCAN` e o `scripts/restore-backup.mjs` continuam funcionando sem mudança — nenhum dos dois enumera chaves conhecidas.

### Migração

1. Deploy da Fase 0 com **leitura dupla**: lê `team:sustentacao:X`; se ausente, cai para a chave global antiga.
2. Script one-shot copia as três chaves globais para o prefixo `team:sustentacao:`. Não sobrescreve destino existente (mesmo padrão de `api/migrate-ch.js`).
3. Deploy seguinte remove a leitura dupla e apaga as chaves antigas.

## 3. Acesso

`api/_allowlist.js` — `role` deixa de ser campo e passa a ser derivado:

```js
// sustentação — inalterado exceto pelos campos novos
'ricardo.correa@…':      { memberId: 'Ricardo', teamId: 'sustentacao', adminOf: ['sustentacao'] },
'alice.santos@…':        { memberId: 'Alice',   teamId: 'sustentacao', adminOf: [] },
'alessandra.lisboa@…':   { memberId: null,      teamId: null,          adminOf: '*' },

// infraestrutura — Alberth administra E faz plantão
'alberth.teixeira@…':    { memberId: 'Alberth', teamId: 'infra', adminOf: ['infra'] },
'gabriel.pavanelli@…':   { memberId: 'Gabriel', teamId: 'infra', adminOf: [] },
'antonio.santos@…':      { memberId: 'Antonio', teamId: 'infra', adminOf: [] },
'diogo.ferrolho@…':      { memberId: 'Diogo',   teamId: 'infra', adminOf: [] },
'caio.rodrigues@…':      { memberId: 'Caio',    teamId: 'infra', adminOf: [] },

// desenvolvimento — Anselmo administra sem estar na escala (como Alessandra)
'anselmo.barreto@…':     { memberId: null,               teamId: null,              adminOf: ['desenvolvimento'] },
'leonardo.rodrigues@…':  { memberId: 'Leonardo Menegon', teamId: 'desenvolvimento', adminOf: ['desenvolvimento'] }, // ⚠ admin TEMPORÁRIO para testes
'luis.cunha@…':          { memberId: 'Luis',             teamId: 'desenvolvimento', adminOf: [] },
'adalberto.teshima@…':   { memberId: 'Adalberto',        teamId: 'desenvolvimento', adminOf: [] },
'pedro.soares@…':        { memberId: 'Pedro',            teamId: 'desenvolvimento', adminOf: [] },
'dante.escame@…':        { memberId: 'Dante',            teamId: 'desenvolvimento', adminOf: [] },
'leonardo.santos@…':     { memberId: 'Leonardo Matheus', teamId: 'desenvolvimento', adminOf: [] },
'jonata.gomes@…':        { memberId: 'Jonata',           teamId: 'desenvolvimento', adminOf: [] },
'icaro.motta@…':         { memberId: 'Ícaro',            teamId: 'desenvolvimento', adminOf: [] },
```

Os três casos que o modelo `teamId` + `adminOf` precisa cobrir aparecem todos aqui: admin fora da escala (`Alessandra`, `Anselmo`), admin que também faz plantão na própria equipe (`Alberth`, `Leonardo Menegon`, `Ricardo`) e admin de todas (`Alessandra`).

`resolveAccess(email)` → `{ memberId, teamId, adminOf, role }`, onde `role` é `'admin'` se `adminOf` não vazio, `'member'` se há `memberId`, senão `'viewer'`. `requireUser` propaga os quatro campos.

| Ação | Regra |
|---|---|
| Ler escala e substituições de qualquer equipe | Livre, inclusive sem login |
| Editar escala / rótulos de uma equipe | `adminOf` contém a equipe |
| Criar/remover substituição | Admin da equipe, **ou** member que é titular ou substituto |
| Ver/editar CH de uma pessoa | A própria pessoa, ou admin da equipe dela |
| Fechar/reabrir mês | Admin da equipe da pessoa |

## 4. API

| Endpoint | Mudança |
|---|---|
| `GET /api/schedule?team=` | Retorna `{ overrides, labels }` da equipe. Sem `team` → `sustentacao` na Fase 0; obrigatório a partir da Fase 1 |
| `POST /api/schedule` | Body ganha `team`. Escopo: `adminOf` ⊇ `team`. Substitui `role !== 'admin'` |
| `GET/POST/DELETE /api/substitutions` | Idem, com `team` |
| `GET/POST /api/ch` | Equipe derivada de `MEMBERS[person].teamId`; escopo checado contra ela |
| `POST/DELETE /api/ch-close` | Idem |
| `/api/migrate-ch` | **Remover** — endpoint temporário ainda em produção; com admin escopado, é bypass de escopo |

`api/_validate.js`: `TEAM_MEMBERS` (enum fixo de seis) é substituído por validação contra `TEAMS[team].roster`. `team` validado contra as chaves de `TEAMS`. Em `SubPostSchema`, titular e substituto precisam ser do mesmo roster.

## 5. Views

**Seletor de equipe** no topo da aba Escala. Hash `#escala/infra`; persistido no perfil (`teamView`). Padrão: a equipe da pessoa; visitante e viewer abrem em `sustentacao`.

**Calendário** — sem mudança estrutural: um bloco por dia, uma linha por turno. Turnos renderizados **ordenados por horário de início**, não por índice (§6). Acrescenta:
- Slot vago como turno com "sem plantonista", visualmente recuado, clicável pelo admin para atribuir.
- Estado vazio quando a data está fora da vigência da equipe, explicando desde quando ela existe.

**Widget "Agora"** — ignora o seletor e mostra sempre as três equipes, uma linha cada: equipe → quem está → até que horas. Equipe sem cobertura no momento mostra "sem plantão" em vez de sumir. Isso é estado permanente, não exceção: infra não cobre 00:00–09:00 em dia nenhum, e as três têm o vão do expediente.

**Filtro por responsável** — limitado ao roster da equipe selecionada.

**Aba Estrutura** — mantém o padrão atual: tabelas somente-leitura, sem edição (edição versionada segue como futuro, ver ADR-0001). Passa a cobrir as três equipes com um seletor, e **o seletor lista apenas as equipes em `adminOf`** — cada admin vê só a estrutura da equipe dele; quem administra todas vê as três. Para quem não administra equipe alguma, a aba não aparece (hoje a condição é `isAdmin`; passa a ser `adminOf` não vazio).

Para infra e desenvolvimento a tabela mostra os blocos por dia-da-semana, as faixas sem cobertura e o aviso "sem rodízio definido — atribuição manual pelo admin", no lugar da tabela de rotação que a sustentação exibe.

**Controle de Horas** — dropdown "Responsável" agrupado por equipe e recortado por `adminOf`; member continua travado em si mesmo. O sobreaviso é gerado da escala **da equipe da pessoa**, respeitando a vigência. Fórmulas, CSV, NF e fechamento não mudam.

## 6. Dividir turno

A planilha mostra trocas no meio de um bloco em ~5% dos blocos de julho. No modelo atual isso exige três operações do admin (encurtar o original, criar duas partes); esquecer a primeira deixa dois turnos sobrepostos e **ambos recebem sobreaviso pelo mesmo intervalo** — falha silenciosa com consequência financeira.

Ação dedicada: o admin seleciona o turno, informa a hora do corte e quem assume cada parte; o app gera o patch consistente numa operação. Requisitos:

- Impossível deixar sobreposição para trás — as partes são geradas a partir do intervalo original.
- Turnos passam a ser renderizados ordenados por horário de início; o `idx` volta a ser só chave de override.
- Detector de sobreposição no mesmo dia (rede de segurança para turnos criados pelo caminho manual, que continua existindo).

**O detector não pode gritar lobo.** Os dados de produção mostram que sobreposição entre pessoas diferentes é frequentemente **intencional**: em 09/07/2026 (feriado) o admin escalou Marcus Túlio e Alice juntos das 05:00 às 11:00, e Emanoel e Raul juntos das 11:00 às 17:00 — cobertura dupla deliberada, montada como turnos separados. Um aviso genérico de "turnos sobrepostos" seria ruído nesse caso e o admin aprenderia a ignorá-lo. Diferencie:

| Situação | Tratamento |
|---|---|
| **A mesma pessoa** em dois turnos que se sobrepõem | **Aviso.** É pagamento em duplicidade para um indivíduo — nunca intencional |
| Pessoas diferentes, janelas **idênticas** | Indicador passivo de cobertura dupla, sem alarme |
| Pessoas diferentes, sobreposição **parcial** | Aviso discreto — é a assinatura do "esqueci de encurtar o turno original" |

## 7. Defeitos a corrigir no caminho

1. **`expandPatchToFuture` indexa por posição.** [EscalaSobreaviso.jsx:300](../../src/components/EscalaSobreaviso.jsx:300) usa `e.shifts[numIdx]`, mas `numIdx` é a chave do override e `e.shifts` é um array compactado — divergem em dias com turno extra. Corrigir para casar por `s.idx`.
2. **Patch anual estoura o limite de corpo.** Propagar 1 turno por ~365 dias gera ~30 KB contra os 50 KB de `MAX_BODY_BYTES`; 2 turnos estouram. Com equipes montadas à mão isso deixa de ser caso raro. Corrigir enviando em lotes (~150 dias por requisição), com progresso e falha atômica por lote. Expandir no servidor foi descartado: manteria a lógica de escala fora de `src/lib/schedule.js`.
3. **`api/migrate-ch.js`** — remover (item também em §4).
4. **Corrida entre admins** — resolvida de graça pela chave por equipe: dois admins de equipes diferentes deixam de reescrever o mesmo blob.

5. **Noite de sexta até 24:00 — ✅ RESOLVIDO** (junto com a Fase 0, por decisão do usuário). `WEEKDAY_SHIFTS[5]` tinha `18:00 – 24:00` (6h) enquanto o `Dia` de sábado começa às 23:00 de sexta: duas pessoas de sobreaviso na mesma hora, ambas recebendo por ela. Corrigido com **vigência por entrada de turno** (`from`/`until`) a partir de `FRIDAY_NIGHT_CHANGE = "2026-08-01"`, preservando junho e julho de 2026. Verificado: 47 sextas alteradas na base, zero alterações fora delas, `idx` estável nos 388 dias, e **zero diferenças na escala de produção** — os 49 overrides já produziam o resultado correto, então a mudança é invisível hoje e serve para que a próxima extensão de `RANGE_END` não reintroduza o defeito.

   Restaram **6 sextas com sobreposição real** (12, 19 e 26/06 e 03, 10 e 17/07 de 2026), anteriores ao override — nelas a hora das 23:00 à meia-noite foi paga a duas pessoas. **Caso encerrado por decisão do responsável: não serão corrigidas.** O valor é pequeno, os meses são passados e mexer em folha já processada custa mais do que o erro. Não reabrir este assunto.

6. **Override de `time` sem `dur` deixa a duração exibida errada.** Em produção, 2026-07-09 idx2 tem `time: "17:00 - 23:00"` sem `dur`, e o merge mantém o `dur: "5h"` da base — a tela mostra 5h para um turno de 6h. O pagamento está certo (`scheduleEntries` deriva de `shift.time`, não de `dur`), mas o rótulo mente. `dur` deveria ser derivado de `time` em vez de armazenado, ou recalculado a cada edição.

## 8. Faseamento

### Fase 0 — refactor invisível
Motor genérico, `dayStart`, registry com apenas a sustentação, chaves por equipe com leitura dupla, migração das três chaves.

**Aceite:** a escala renderizada é idêntica à atual, dia a dia, em todo o range — mesmas pessoas, mesmos horários, mesmas folgas, mesmos segmentos de plantão. Nenhuma mudança visível na UI. Comparar saída de `buildSchedule` antes e depois é o teste.

### Fase 1 — equipe visível
Allowlist com `teamId`/`adminOf` e `role` derivado, escopo de escrita nos quatro endpoints, seletor de equipe, "Agora" multi-equipe, infra e desenvolvimento cadastradas com seus blocos e slots vagos, aba Estrutura com seletor. Correção dos defeitos 1 e 2. Detector de sobreposição.

**Aceite:** admin de uma equipe não consegue salvar edição em outra (403); slot vago aparece e é atribuível; equipe fora da vigência mostra estado vazio; infra mostra "sem plantão" entre 00:00 e 09:00; a sustentação continua se comportando como na Fase 0.

### Fase 2 — controle de horas multi-equipe e dividir turno
Dropdown escopado, sobreaviso gerado da equipe correta com corte por vigência, ação "Dividir turno".

**Aceite:** pessoa de infra atribuída a um turno vê o SA correspondente no CH dela; nenhum SA é gerado antes de `startsOn`; totais da sustentação inalterados mês a mês contra os valores atuais; dividir um turno de 9h em 4h + 2h + 3h produz exatamente 9h de sobreaviso somadas.

### Futuro
Rotação de infra e desenvolvimento quando as equipes definirem uma; estrutura editável na UI (exige vigência versionada — ver ADR-0001); identificador estável de pessoa na migração para PostgreSQL/Turso (ADR-0003).
