# Escala de Sobreaviso — Documentação de Projeto

App interno da MT Fintech para a equipe de sobreaviso (6 pessoas).
Gerencia o calendário de plantões e o controle financeiro de horas.

**URL em produção**: https://escala-sobreaviso.vercel.app
**Repo**: https://github.com/rikardop05/escala-sobreaviso (DEVE permanecer PRIVADO — contém e-mails)

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Vite + React 18 + Tailwind CSS |
| Auth | Clerk — Google OAuth (`@clerk/clerk-react` no front, `@clerk/backend` no back) |
| Backend | Vercel Serverless Functions (`/api/*.js`) |
| Banco atual | Redis via ioredis — Vercel KV com `REDIS_URL` |
| Banco futuro | PostgreSQL — schema em `db/schema.sql` (não migrado ainda) |
| Deploy | GitHub `main` → Vercel (auto-deploy) |

---

## Estrutura de Arquivos

```
src/
  main.jsx                  ClerkProvider + ReactDOM root; publishable key hardcoded (público por design)
  App.jsx                   Guard de auth, roteamento por role, navegação por abas (sem ProfileSetup)
  index.css                 Tailwind directives
  lib/
    api.js                  Hook useApi() — fetch autenticado com JWT Clerk
    schedule.js             Motor genérico da escala — buildSchedule(team, overrides, labels), buildOnCallSegments(schedule, dayStart) (leia seção Escala abaixo)
    teams.js                Registry de equipes (MEMBERS, TEAMS) — sustentação, infraestrutura e desenvolvimento (Fase 1 da spec multi-equipe; ver docs/specs/multi-equipe.md, ADR-0001, ADR-0003). Importável de api/* (plain JS, sem JSX/Vite)
    theme.js                Tema unificado getTheme(dark) — tokens de cor AA usados pelos dois views (não criar temas locais)
  components/
    ui.jsx                  Kit compartilhado: Icon (SVGs), SaveStatus, Snackbar (undo), ConfirmDialog, Skeleton, friendlyError()
    EscalaSobreaviso.jsx    Calendário mensal, filtro, substituições, edição de escala (admin)
    ControleDeHoras.jsx     CH: parâmetros, lançamentos HE/Comp, relatório, exportação CSV; admin pode ver qualquer membro
    EstruturaEscala.jsx     Aba "Estrutura" (só admin, #estrutura): tabelas read-only da estrutura base — semana (WEEKDAY_SHIFTS) e escada de FDS (gerada de WEEKEND_ROSTER). Fase 1: só visualização; edição versionada é fase futura

api/
  _allowlist.js             EDITAR AQUI: mapeamento email→{memberId, teamId, adminOf}; resolveAccess(), adminCovers()
  _auth.js                  requireUser(req) — verifica JWT + busca email via Clerk API + resolve { memberId, teamId, adminOf, role }
  _validate.js              Schemas Zod — TeamIdSchema, schedulePostSchemaFor(team)/subPostSchemaFor(team) validam contra TEAMS[team].roster (src/lib/teams.js)
  _redis.js                 kvGet / kvSet / kvScanAll / kvGetWithFallback — helpers JSON sobre ioredis; kvGetWithFallback lê a chave por equipe, cai para a global antiga se ausente
  _backup-crypto.js         encrypt/decrypt AES-256-GCM dos dumps de backup (BACKUP_ENCRYPTION_KEY)
  profile.js                GET/POST preferências do usuário (dark, filter, monthKey); role/memberId vêm da allowlist
  substitutions.js          GET/POST/DELETE substituições, escopadas por equipe (?team= / body.team; chave team:{team}:substitutions, leitura dupla só na sustentação)
  ch.js                     GET/POST lançamentos e parâmetros CH; acesso: a própria pessoa, ou admin da equipe dela (MEMBERS[pessoa].teamId)
  ch-close.js               Fechamento mensal do CH: GET fechamentos; POST fecha mês; DELETE reabre — sempre admin da equipe da pessoa-alvo
  schedule.js               GET {overrides,labels} escopado por equipe (?team=, default sustentacao); POST exige team no body + adminCovers(adminOf, team), carimba editedAt
  backup.js                 Cron diário: dump do Redis → cifra → Vercel Blob; poda >30 dias (ver Backup abaixo)

scripts/
  restore-backup.mjs        Restauração de um dump para o Redis (dry-run por padrão; --commit aplica)
  migrate-team-keys.mjs     One-shot da Fase 0 multi-equipe: copia schedule_overrides/schedule_labels/substitutions → team:sustentacao:* (dry-run por padrão; --commit aplica; não sobrescreve destino existente)

_arquivo/planejamento/db/
  schema.sql                Schema PostgreSQL — planejamento; desatualizado vs. estado atual (ver Migração futura)

vercel.json                 SPA rewrite (rota não-/api/* → /index.html) + cron de backup (crons)

public/
  logo.png                  Ícone/marca do app (favicon + apple-touch-icon em index.html; mark na nav em App.jsx)

CONTEXT.md                  Glossário do domínio — linguagem canônica (Equipe, Turno, Atribuição, Slot vago…)
docs/adr/                   Decisões estruturais e por que foram tomadas
docs/specs/
  multi-equipe.md           Spec de suporte a três equipes — Fases 0 (motor genérico) e 1 (equipe visível) implementadas; Fase 2 (CH multi-equipe, dividir turno) pendente
```

---

## Sistema de Acesso (Allowlist)

Desde a Fase 1 da spec de múltiplas equipes (`docs/specs/multi-equipe.md` §3), `role` **não é
mais um campo** da allowlist — é derivado de `teamId`/`adminOf` por `resolveAccess()`. Isso
substitui o modelo antigo (um admin global) por escopo por equipe: um admin de uma equipe não
enxerga nem edita as outras, exceto quem tem `adminOf: '*'`.

### Como configurar

Edite `api/_allowlist.js` — é o único arquivo que precisa ser alterado para adicionar/remover pessoas:

```js
export const ALLOWLIST = {
  'membro@dominio.com.br':      { memberId: 'Fulano', teamId: 'sustentacao', adminOf: [] },
  'admin-equipe@dominio.com.br':{ memberId: 'Fulano', teamId: 'sustentacao', adminOf: ['sustentacao'] },
  'admin-tudo@dominio.com.br':  { memberId: null,      teamId: null,          adminOf: '*' },
};
```

Regras:
- `memberId` **deve bater exatamente** com uma chave de `MEMBERS` em `src/lib/teams.js`
  (exceção: admin que não faz plantão em equipe nenhuma usa `memberId: null`, `teamId: null` —
  ex.: `Alessandra`, `Anselmo`)
- `teamId`: a equipe a que a pessoa pertence (roster/CH); `null` se `memberId` for `null`
- `adminOf`: array de `teamId`s que a pessoa administra (escala + substituições + CH daquelas
  equipes), ou `'*'` para administrar todas. `[]` = não administra nenhuma
- E-mails são comparados em lowercase (case-insensitive)
- Qualquer e-mail fora da lista → `role: 'viewer'` automático (sem CH, sem edição)
- **Adicionar uma pessoa nova**: primeiro cadastrá-la em `MEMBERS`/`TEAMS[teamId].roster` em
  `src/lib/teams.js`, só depois referenciar o `memberId` aqui — a validação de input (Zod) lê o
  roster de `teams.js` diretamente, não há mais uma lista separada para manter em sincronia

### `resolveAccess(email)` e `adminCovers(adminOf, teamId)`

```js
resolveAccess(email) → { memberId, teamId, adminOf, role }
// role = 'admin' se adminOf === '*' ou array não-vazio; senão 'member' se há memberId; senão 'viewer'.

adminCovers(adminOf, teamId) → boolean
// true se adminOf === '*' ou adminOf.includes(teamId) — usado por todo endpoint que
// precisa checar "esta pessoa administra ESTA equipe", não só "é admin de algo".
```

`role` continua útil para decisões que não dependem de qual equipe (`canAccessCH`, mostrar a aba
Controle de Horas, etc.); `adminOf` é o que decide escopo por equipe (edição de escala,
substituições, CH de um membro específico — ver tabela abaixo).

### Escopo por ação

| Ação | Regra |
|---|---|
| Ler escala e substituições de qualquer equipe | Livre, inclusive sem login |
| Editar escala / rótulos de uma equipe | `adminCovers(adminOf, team)` |
| Criar/remover substituição | Admin da equipe, **ou** member que é titular ou substituto |
| Ver/editar CH de uma pessoa | A própria pessoa, ou admin da equipe dela (`MEMBERS[pessoa].teamId`) |
| Fechar/reabrir mês do CH | Admin da equipe da pessoa |

**GET `/api/schedule` e GET `/api/substitutions` são públicos** — retornam dados sem autenticação
para suportar a visualização pública. Ambos aceitam `?team=` (default `sustentacao`, para não
quebrar antes do seletor de equipe existir na UI — ver seção Escala). Escrita (POST/DELETE)
sempre requer auth e **exige `team` no body/query** — sem fallback.

**Toda autorização de escrita é garantida no backend** (`requireUser` retorna `adminOf` da
allowlist, nunca do cliente).

### Como `requireUser` funciona

1. Extrai Bearer token do header `Authorization`
2. `verifyToken(token, options)` — verifica assinatura, emissor, expiração. Lança 401 em falha.
3. Resolução de e-mail (dois caminhos, ordem de preferência):
   - **Estratégia 1 — payload JWT**: lê `payload.email` se presente (sem network). Requer configurar o JWT template no Clerk Dashboard → JWT Templates → Default → adicionar `{ "email": "{{user.primary_email_address}}" }`.
   - **Estratégia 2 — Clerk Users API**: `clerkClient.users.getUser(userId)`. Requer `CLERK_SECRET_KEY` no Vercel.
   - Se nenhuma funcionar: e-mail fica `null`, usuário recebe `role: 'viewer'` automaticamente (sem 401). O log do servidor mostrará o erro.
4. `resolveAccess(email)` — cruza com a allowlist
5. Retorna `{ userId, email, memberId, teamId, adminOf, role }`

---

## Regras de Negócio — Escala

### Motor genérico (`src/lib/schedule.js`) e registry de equipes (`src/lib/teams.js`)

Desde a Fase 0 da spec de múltiplas equipes (`docs/specs/multi-equipe.md`), o motor que gera a
escala não conhece mais "a sustentação" diretamente — ele recebe uma **equipe** como parâmetro:

```js
buildSchedule(team, overrides = {}, labels = {})
buildOnCallSegments(schedule, dayStart)   // dayStart OBRIGATÓRIO — sem default (ver abaixo)
```

- `team` vem de `TEAMS` em `src/lib/teams.js` — `sustentacao`, `desenvolvimento` e `infra`
  (as três da spec, desde a Fase 1). Formato: `{ id, nome, dayStart, startsOn, endsOn, roster,
  blocos, rotacao }`. `blocos[dow]` são os turnos por dia da semana; na sustentação têm dono fixo
  (seg–sex), em infra/desenvolvimento nascem vagos (`persons: []`, sem rodízio — admin atribui à
  mão) e cobrem os 7 dias. `rotacao` (só a sustentação tem) gera os turnos de fim de semana via
  escada — `null` nas outras duas. `startsOn`/`endsOn` recortam a vigência da equipe contra
  `RANGE_START`/`RANGE_END` (globais, inalterados); infra e desenvolvimento começam em
  `2026-07-01`.
- `dayStart` substitui a antiga heurística posicional (`idx === 0 && crosses && startMin >=
  12*60`) por um dado explícito por equipe (ADR-0002): um turno cujo horário de início é
  `>= dayStart` (quando `dayStart > "00:00"`) pertence ao dia anterior no calendário — é
  pernoite. Na sustentação `dayStart = "23:00"` (Madrugada e Dia do FDS pernoitam); em infra e
  desenvolvimento `dayStart = "00:00"` — nenhum turno pernoita, cada um fica no dia em que foi
  gerado. Efeito colateral esperado (canto, não bug, só na sustentação): um turno **extra**
  (feriado) com início após as 23:00 agora pernoita também, o que a heurística antiga (restrita a
  `idx === 0`) não fazia.
- **`dayStart` é obrigatório em `buildOnCallSegments`, `currentOnCall` e `adjacentOnCall`** — sem
  valor padrão (Fase 1 removeu os defaults `"00:00"`/`"23:00"` da Fase 0). Um default de equipe
  errada desloca a escala em um dia sem erro visível — cada chamador passa explicitamente o
  `dayStart` da equipe cuja escala está consultando (`team.dayStart`).
- `PEOPLE`/`CH_NAMES`/`WEEKDAY_SHIFTS`/`WEEKEND_ROSTER`/`WEEKEND_CYCLE`/`ANCHOR`/
  `WEEKEND_CHANGE`/`RANGE_START`/`RANGE_END` continuam exportados de `schedule.js` sem mudança —
  são a fonte de dados que `teams.js` empacota em `TEAMS.sustentacao` (não duplica). Infra e
  desenvolvimento não têm equivalente em `schedule.js` (só existiam na spec) — nascem direto em
  `teams.js`. `EstruturaEscala.jsx`, `EscalaSobreaviso.jsx` e `ControleDeHoras.jsx` continuam
  importando `PEOPLE`/`CH_NAMES`/etc. normalmente (só sustentação, inalterado nesta fase); as
  chamadas a `buildSchedule`/`currentOnCall`/`adjacentOnCall` passam `TEAMS.sustentacao` /
  `TEAMS.sustentacao.dayStart` explicitamente.
- `MEMBERS` (`src/lib/teams.js`) é a fonte única de pessoas das **três** equipes (19 no total:
  6 sustentação + 8 desenvolvimento + 5 infra) — usada pelo backend (`api/_validate.js`,
  `api/ch.js`, `api/ch-close.js`) para validar `person` e resolver a equipe de alguém
  (`MEMBERS[nome].teamId`). A UI do Controle de Horas ainda usa só `PEOPLE`/`CH_NAMES`
  (sustentação) — ver "NÃO faça" da Fase 1 em §8 da spec.

```js
PEOPLE    = { Emanoel, "Marcus Túlio", Ricardo, Carlos, Raul, Alice }
CH_NAMES  = ["Raul", "Emanoel", "Marcus Túlio", "Ricardo", "Carlos", "Alice"]
// Todos os membros participam do Controle de Horas (Alice incluída em jul/2026)
// MEMBERS em teams.js espelha os mesmos 6 (mais teamId) — ainda não é a fonte que a UI usa.
```

### Turnos de semana (seg–sex) — `WEEKDAY_SHIFTS`

Cada dia da semana tem 3 turnos fixos:

| Turno | Horário | Duração |
|-------|---------|---------|
| Madrugada | 23:00 – 04:00 | 5h |
| Manhã | 04:00 – 09:00 | 5h |
| Noite | 18:00 – 23:00 | 5h |

⚠ **Vigência por entrada de turno**: uma entrada de `WEEKDAY_SHIFTS[dow]` pode declarar `from`/`until` (`YYYY-MM-DD`, inclusivos) e só vale nesse intervalo — é assim que a estrutura é corrigida sem reescrever o passado. Hoje há um único caso: a **Noite de sexta** ia até **24:00 (6h)** e sobrepunha 1h ao `Dia` de sábado (que começa 23:00 de sexta), fazendo duas pessoas receberem sobreaviso pela mesma hora; foi corrigida para `18:00 – 23:00` (5h) a partir de `FRIDAY_NIGHT_CHANGE = "2026-08-01"`, com a entrada antiga preservada (`until: "2026-07-31"`) para não alterar a folha de junho/julho de 2026.

`blocosAtivos(blocos, dow, dateStr)` resolve quais entradas valem numa data. A filtragem acontece **antes** da atribuição de `idx`, então os índices permanecem estáveis e os overrides já gravados continuam apontando para o turno certo. Os campos `from`/`until` não vazam para o turno retornado. Todo leitor de `WEEKDAY_SHIFTS` deve passar por essa função — `EstruturaEscala.jsx` resolve com a data de hoje.

### Fins de semana — rotação com vigência por data

```
Dia  (sáb/dom): 23:00 (véspera) – 11:00  (12h)  ← handoff às 23:00, igual aos dias úteis
Noite (sáb/dom): 11:00 – 23:00 (12h)
```
Handoff fixo às 23:00/11:00: Sex→Sáb→Dom→Seg conectam sem exceção (a Madrugada de
segunda começa 23:00 do domingo). Durações seguem 12h → **sem impacto financeiro**,
por isso a mudança de horário vale para toda a faixa. `buildOnCallSegments(schedule,
dayStart)` trata todo turno cujo início é `>= dayStart` (23:00 na sustentação) como
pernoite que pertence à véspera — Madrugada útil e Dia do FDS caem nessa regra (ver
ADR-0002; substitui a antiga heurística restrita a `idx === 0`).

`weekendAssignment(saturday)` escolhe a rotação pela data do sábado e sempre retorna `folga` como **array**. Internamente delega para a função genérica `resolveRotation(rotacao, saturday)`, que é o que `buildSchedule(team, …)` chama de fato usando `team.rotacao` — `weekendAssignment` é mantida só para compatibilidade com `EstruturaEscala.jsx`, que ainda só conhece a sustentação:

- **FDS antes de `WEEKEND_CHANGE` (2026-07-18)** → `WEEKEND_CYCLE` antigo: 5 semanas, 5 pessoas, **1 folga** (Alice não faz FDS). `ANCHOR = 2026-06-13`, `cycleIndex` via `((diff % 5)+5)%5`. Mantido para preservar histórico/folha.
- **FDS a partir de `WEEKEND_CHANGE`** → **escada de 6 semanas** GERADA de `WEEKEND_ROSTER = [Alice, Emanoel, Ricardo, Raul, Marcus Túlio, Carlos]`: cada pessoa avança uma estação por semana nas estações `[Sáb Dia, Sáb Noite, Dom Dia, Dom Noite, Folga, Folga]` → 4 trabalham + **2 folgam**. Fórmula: `estação s na semana w = roster[(s-w) mod 6]`. A ordem foi derivada por **continuidade** com o ciclo antigo (último FDS 11–12/07): quem folgou continua folgando na virada, Alice entra no Sáb Dia, os demais só avançam.

⚠️ Mover `WEEKEND_CHANGE`, `ANCHOR` ou `WEEKEND_ROSTER` recalcula a escala (histórico e futuro). Meses de CH fechados ficam protegidos pelos snapshots; meses abertos recalculam.

**`RANGE_START = 2026-06-08`** / **`RANGE_END = 2027-06-30`** — período global; `buildSchedule(team, …)` recorta isso contra `team.startsOn`/`team.endsOn` (na sustentação, idênticos a `RANGE_START`/sem fim, então não há recorte hoje). Para estender: atualizar apenas `RANGE_END`.

`day.folga` é **sempre array** (vazio em dia útil; 1 nome no ciclo antigo; 2 na escada nova) — a UI usa `d.folga.includes(...)` / `d.folga.join(', ')`.

### Overrides de escala (admin)

`buildSchedule(team, overrides = {}, labels = {})` aceita overrides por dia/índice e rótulos por dia (chamadas atuais passam `TEAMS.sustentacao` como `team`):
```js
// overrides: { 'YYYY-MM-DD': { '0': { persons:['Ricardo'], period, time, dur }, '1': null } }
//   null = revert para base (num índice extra, remove o turno)
//   índice além dos turnos base (ex.: '3') vira um turno NOVO — dias custom/feriado
//   persons: string[] (multi-pessoa). person (string) ainda é aceito como legado.
// labels: { 'YYYY-MM-DD': 'Feriado' } — rótulo opcional do dia
```

Cada turno retornado carrega um `idx` **estável** (a chave do override), usado pela UI para seleção/edição/remoção — não confie na posição no array. Use `shiftPeople(shift)` (não `shift.person`) para ler as pessoas de um turno em qualquer lugar.

Overrides e labels ficam em `team:sustentacao:schedule_overrides` / `team:sustentacao:schedule_labels` (chaves por equipe, Fase 0 — ver "Redis — Todas as Chaves" abaixo). O admin edita no modo de edição do calendário: seleciona turnos + form (multi-seleção de pessoas), **"+ Adicionar turno"** por dia (feriados), reset (remove turno extra) e um input de **rótulo do dia**. POST `/api/schedule` com `{ overrides?, labels? }`.

**Carimbo de edição**: ao aplicar o patch, `api/schedule.js` adiciona `editedAt` (ISO) a cada override não-nulo (só data, sem autor). O cliente usa isso para um marcador **"alterado dd/mm" que expira após 14 dias** (`EDIT_RECENT_MS` em `EscalaSobreaviso.jsx`). No modo de edição, todos os overrides ficam destacados (gerenciamento).

O widget "Agora" usa `currentOnCall(now, schedule, subs, dayStart)` e `adjacentOnCall(now, schedule, subs, dayStart)` — `EscalaSobreaviso.jsx` passa `TEAMS.sustentacao.dayStart` explicitamente (sem default desde a Fase 1). Ambos derivam de `buildOnCallSegments(schedule, dayStart)`, que calcula os blocos de plantão a partir do **`shift.time` real** (não de janelas fixas), preservando a convenção de atribuição de dia (derivada de `dayStart`: na sustentação, todo turno que começa às 23:00 ou depois pertence ao dia seguinte no calendário). Assim, edições de horário e turnos de feriado são refletidos, e o "Agora" mostra **todas** as pessoas quando o turno é multi-pessoa.

### Substituições

`getActiveSub(person, dateStr, subs)` → busca substituição ativa onde `titular === person` e `dateStr` está no período.
Lista `subs` é compartilhada (todos veem as mesmas substituições via `team:sustentacao:substitutions` — chave por equipe, Fase 0).

**Resolução de quem aparece no turno — fonte única `resolveShiftPeople(shift, dateStr, subs)`** → retorna `[{ person, coveringFor, titular }]` aplicando as substituições. Usada pelo calendário, filtro, widget "Agora" (via `buildOnCallSegments`/`currentOnCall`/`adjacentOnCall`, que carregam `personsOverridden` no segmento) **e** pelo cálculo do CH (`scheduleEntries`) — todos compartilham a mesma regra, então calendário e folha nunca divergem.

**Regra "edição vence substituição"**: quando o admin define explicitamente as pessoas de um turno por override, `buildSchedule` marca `shift.personsOverridden = true` (só quando o override mexe em `persons`/`person` — override só de horário/rótulo **não** trava). Um turno travado **não** é redirecionado por uma substituição em que a pessoa colocada seja titular. Isso torna simétricos os dois caminhos de escalar alguém: via formulário de Substituição (`Carlos → Alice`, mostra Alice sem encadear) e via edição da escala (`persons: [Alice]`, também mostra Alice mesmo que Alice tenha substituição própria ativa). Substituições seguem agindo normalmente sobre a rotação base (turnos sem override de pessoa).

**Aviso de conflito** (painel de edição, `editSubConflicts` em `EscalaSobreaviso.jsx`): ao selecionar turnos e escolher pessoas que **têm substituição ativa como titular** na data selecionada, um aviso WARN é exibido explicando que a pessoa será mantida no turno (a substituição não vale ali) e sugerindo o formulário de Substituições caso o substituto deva assumir.

---

## Controle de Horas (CH)

### Acesso

`canAccessCH = role === 'admin' || role === 'member'`

Admin pode trocar o "Responsável" via dropdown para ver/editar CH de qualquer membro.
Member só vê/edita o próprio painel.

### Redis — Chaves CH

Chaves usam `memberId` (não `userId`) para permitir acesso cross-user do admin:
- `member:{memberId}:ch_entries` — lançamentos HE/Comp
- `member:{memberId}:ch_params` — parâmetros de remuneração/jornada

⚠️ Migração: chaves anteriores eram `user:{clerkId}:ch_*`. Dados existentes não são migrados automaticamente.

### Cálculo financeiro

```
valorHora       = remuneracao / jornada
valorSobreaviso = (valorHora / 3)   × horasSA   ← adicional de 1/3
valorHoraExtra  = (valorHora × 1.5) × horasHE   ← adicional de 50%
valorComp       = (valorHora / 3)   × horasComp ← mesmo fator do SA; abate da NF (Compensação não tem valor próprio)
valorNF         = remuneracao + valorSobreaviso + valorHoraExtra − valorComp
```

SA vem de `buildSchedule(TEAMS.sustentacao, overrides, labels)` — reflete edições do admin no cálculo e no CSV. O `scheduleEntries` resolve a pessoa via `resolveShiftPeople(shift, dk, subs)` (mesma regra do calendário, incluindo "edição vence substituição"), então em turno multi-pessoa (feriado) **cada** pessoa ganha seu próprio SA pelas horas do turno, e substituições redirecionam o SA exatamente como no calendário.

**Valor da NF**: card no Relatório do mês com remuneração + SA + HE − Compensação. Protegido igual à remuneração mensal (oculto por padrão, "R$ ••••••", olho revela — sem edição, é derivado). Estado (`nfVisible`) reseta ao trocar de pessoa. Entra também no CSV (`Valor compensação` e `VALOR DA NF`). Em meses fechados, usa `closedSnap.params.remuneracao` e `closedSnap.totals` (snapshots anteriores a esta feature não têm `valorComp` — tratado como 0).

### Fechamento mensal (folha de pagamento)

Sem fechamento, os valores são recalculados a cada render — editar remuneração/escala muda meses passados retroativamente. O fechamento congela o mês:

- **Fechar mês** (só admin, botão no Relatório): grava snapshot imutável `{ closedAt, closedBy, params, totals, entries[] }` em `member:{id}:ch_closed[YYYY-MM]`. Recusa fechar mês já fechado (409).
- **Mês fechado**: relatório, ledger e CSV usam o snapshot (badge "Mês fechado" + "congelados"); novos lançamentos com data nesse mês são bloqueados no cliente; botões editar/excluir somem. Parâmetros continuam editáveis — só afetam meses abertos.
- **Reabrir** (só admin): descarta o snapshot; valores voltam a ser recalculados.
- Totais são calculados no cliente. **Não é uma restrição técnica** — `api/*.js` importa módulos de `src/lib/` normalmente desde a Fase 1 (`api/_validate.js`, `api/ch.js` e `api/ch-close.js` importam `TEAMS`/`MEMBERS` de `src/lib/teams.js`; são módulos ESM simples, sem JSX nem nada específico de Vite, e o bundler do Vercel rastreia o import sem problema). A escolha é não duplicar a lógica financeira do CH em dois runtimes: o snapshot é validado por schema e a ação é exclusiva de admin — congela o que o admin viu e aprovou na tela, sem reimplementar `buildSchedule`/cálculo de horas no servidor para conferir.
- ⚠ O bloqueio de lançamento em mês fechado é client-side; `api/ch.js` não valida contra `ch_closed` (aceitável para ferramenta interna; endurecer na migração Postgres).

---

## Autenticação

### Fluxo completo

Não autenticado: `<PublicApp>` em `src/App.jsx` renderiza escala + botão "Entrar".
`useApi()` omite `Authorization` quando token é null — endpoints GET públicos funcionam sem header.

```
Browser → Clerk (Google OAuth) → JWT
    ↓
useApi() [src/lib/api.js]
  getToken() → Bearer <JWT>  (null se não autenticado — omitido no header)
  fetch(/api/*)
    ↓
requireUser(req) [api/_auth.js]
  verifyToken()        ← assinatura + emissor + expiração
  clerkClient.getUser()← e-mail verificado via Clerk API
  resolveAccess()      ← allowlist → { memberId, role }
  return { userId, email, memberId, role }
    ↓
Handler usa role para controle de acesso, memberId para isolar dados
```

### Variáveis de ambiente (Vercel)

| Variável | Uso |
|----------|-----|
| `REDIS_URL` | Auto-injetada pelo Vercel KV — ioredis connection |
| `CLERK_JWT_KEY` | RSA PEM pública (Clerk → API Keys → JWT Public Key). Verificação local, sem rede. **Preferido.** |
| `CLERK_SECRET_KEY` | Necessário para a Estratégia 2 de resolução de e-mail (Users API). Também necessário se `CLERK_JWT_KEY` estiver ausente. Sem esta variável, todos os usuários recebem `role: 'viewer'`. |
| `BLOB_READ_WRITE_TOKEN` | Auto-injetada ao adicionar um Blob Store no painel do Vercel. Usada pelo backup diário. |
| `BACKUP_ENCRYPTION_KEY` | 32 bytes (hex de 64 chars ou base64) que cifram os dumps. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Guarde fora do Vercel também** — sem ela o backup é irrecuperável. |
| `CRON_SECRET` | Segredo que o Vercel Cron envia como `Authorization: Bearer` ao chamar `/api/backup`. Sem ela o endpoint fica acessível só a admin autenticado (cron não roda). |

### Profile e localStorage

1. Montagem: lê `localStorage` → mostra app imediatamente se há cache válido
2. GET `/api/profile` → `{ memberId, role, dark, filter, monthKey }` (memberId/role da allowlist)
3. `saveProfile` só persiste preferências (`dark`, `filter`, `monthKey`) — role/memberId são somente-leitura

---

## Redis — Todas as Chaves

| Chave | Formato | Proprietário |
|-------|---------|--------------|
| `user:{clerkId}:profile` | `{ dark, filter, monthKey }` | Por usuário |
| `member:{memberId}:ch_entries` | `[{ id, person, tipo, data, inicio, fim, projeto, atividade }]` | Por membro |
| `member:{memberId}:ch_params` | `{ [memberId]: { remuneracao, jornada } }` | Por membro |
| `member:{memberId}:ch_closed` | `{ 'YYYY-MM': { closedAt, closedBy, params, totals, entries[] } }` | Por membro |
| `team:{teamId}:substitutions` | `[{ id, titular, substituto, from, until }]` | Compartilhado (por equipe) |
| `team:{teamId}:schedule_overrides` | `{ [dayKey]: { [idx]: { persons[]?|person?, period, time, dur, editedAt } } }` (idx extra = turno novo) | Compartilhado (por equipe) |
| `team:{teamId}:schedule_labels` | `{ [dayKey]: string }` — rótulo do dia (ex.: "Feriado") | Compartilhado (por equipe) |

`teamId` é `sustentacao`, `desenvolvimento` ou `infra` (`src/lib/teams.js`). Infra e
desenvolvimento nunca tiveram chave global — só a sustentação precisa de fallback.

⚠️ **Migração em andamento (chaves da sustentação, Fase 0 multi-equipe)**: as três chaves da
sustentação trocaram o nome global (`substitutions`, `schedule_overrides`, `schedule_labels`)
pelo prefixo `team:sustentacao:`. Leitura tem fallback automático (`kvGetWithFallback` em
`api/_redis.js`): lê a chave nova, cai para a global antiga se ausente. Escrita vai sempre para a
chave nova. Rode `scripts/migrate-team-keys.mjs --commit` para copiar os dados existentes das
chaves antigas (dry-run por padrão; não sobrescreve destino já populado). Só depois de confirmar
a migração e remover a leitura dupla (deploy futuro) as chaves antigas devem ser apagadas — ver
§2 "Migração" em `docs/specs/multi-equipe.md`.

O backup faz `SCAN` de **todas** as chaves (não depende desta lista) — chaves novas entram no dump automaticamente.

---

## Validação de Input (Zod)

`api/_validate.js` centraliza todos os schemas Zod e os helpers `validate()` / `checkBodySize()`.
Desde a Fase 1, os schemas de escala/substituições são **por equipe**: `TeamIdSchema` valida o
`team` recebido (`z.enum(Object.keys(TEAMS))`), e só depois `schedulePostSchemaFor(team)` /
`subPostSchemaFor(team)` montam o schema de pessoas contra `TEAMS[team].roster` — o roster nunca
é fixo, então **adicionar uma pessoa em `src/lib/teams.js` já basta**; não há mais um enum
separado (`TEAM_MEMBERS`) para manter em sincronia manualmente.

| Endpoint | Schema |
|----------|--------|
| `schedule` GET | Público — `?team=` (default `sustentacao`), valida contra `TEAMS`; retorna `{ overrides, labels }`. |
| `schedule` POST | `team` obrigatório no body (`TeamIdSchema`) → `schedulePostSchemaFor(team)` — `{ team, overrides?, labels? }`. `overrides` = patch (record `dayKey → idx → OverrideObj | null`; `OverrideObj` tem `person?`/`persons[]?` validados contra `TEAMS[team].roster`, índices extras permitidos). `labels` = `LabelPatchSchema` (`dayKey → string | null`). Aceita também um patch cru (compat.). |
| `substitutions` GET | Público — `?team=` (default `sustentacao`). |
| `substitutions` POST | `team` obrigatório no body → `subPostSchemaFor(team)` — `titular`/`substituto` do roster da equipe; `until >= from`; `titular ≠ substituto`. |
| `substitutions` DELETE | `id` e `team` (query) obrigatórios, validados contra `TEAMS`. |
| `ch` POST | `ChPostSchema` — `entries[]` (com `tipo` enum, `person` validado contra `MEMBERS` de **todas** as equipes), `params` record, `person` string. Todos opcionais. |
| `ch-close` POST | `ChClosePostSchema` — `person` (qualquer `MEMBERS`, opcional), `month` YYYY-MM, `snapshot` { params, totals, entries[] ≤200 }. |
| `ch-close` DELETE | `month` validado como YYYY-MM (`ChCloseMonthQuery`). |

Ordem de execução: `requireUser` → validação de `team` → checagem de escopo (`adminCovers`) →
`checkBodySize` (50 KB) → `validate(schema)` → Redis.
Erros de validação: log server-side dos primeiros 5 issues; resposta sempre `400 { error: 'Bad request' }`.

---

## Padrões de UI (front)

- **Tema**: sempre via `getTheme(dark)` em `src/lib/theme.js`. Tokens cumprem WCAG AA; não criar dicionários de tema locais nos componentes.
- **Ícones**: SVGs do componente `Icon` em `src/components/ui.jsx` — nunca emoji como ícone.
- **Persistência com feedback**: toda escrita mostra estado (`SaveStatus`: Salvando…/Salvo/Erro com "Tentar de novo") e faz rollback do estado otimista em falha. Parâmetros do CH têm debounce de 600ms.
- **Remuneração mensal oculta** (ControleDeHoras): estilo app de banco — mascarada por padrão ("R$ ••••••"), olho revela, lápis abre edição (input real + confirmar). Estado puramente visual (`remuneracaoVisible`/`remuneracaoEditing`), reseta ao trocar de pessoa e ao concluir a edição; não toca em `setParam`/persistência.
- **Exclusões**: otimistas com `Snackbar` de undo (~6s); nada de window.confirm. Ações em massa ("aplicar/resetar a todos os meses seguintes") pedem `ConfirmDialog`.
- **Erros ao usuário**: sempre via `friendlyError()` — mensagens em PT-BR com ação sugerida; detalhes só no console.
- **View por hash**: `#escala` / `#controle` — refresh preserva a aba; `document.title` acompanha.
- **monthKey salvo no passado é ignorado** na montagem — o app abre no mês atual.
- **Acessibilidade**: foco visível global via `:focus-visible` (index.css); alvos de toque ≥40–44px; seleção de turnos no modo edição usa role="checkbox" + teclado; `prefers-reduced-motion` respeitado.

---

## Backup (Vercel Blob)

Cron diário (`crons` em `vercel.json`, `0 6 * * *` = 03:00 BRT) chama `GET /api/backup`, que:

1. `kvScanAll()` — dump de todas as chaves do Redis em JSON.
2. Cifra com AES-256-GCM (`api/_backup-crypto.js`, chave `BACKUP_ENCRYPTION_KEY`).
3. Sobe em `backups/escala-YYYY-MM-DD-<sufixo>.enc` no Vercel Blob (store **privado**, `access: 'private'`).
4. Poda dumps com mais de **30 dias** (`RETENTION_DAYS` em `api/backup.js`).

- **Duas camadas de proteção**: o store é privado (URL só acessível com token) **e** o dump é cifrado (AES-256-GCM). O dump contém dados financeiros + e-mail do admin (`closedBy`); mesmo que token/URL vaze, o conteúdo é inútil sem a chave.
- **Trigger manual**: um admin autenticado pode chamar `GET /api/backup` para forçar um backup fora do horário.
- **Restaurar**: baixe o `.enc` do Blob Store no painel do Vercel, depois `BACKUP_ENCRYPTION_KEY=… REDIS_URL=… node scripts/restore-backup.mjs <arquivo-local>` — dry-run por padrão (só lista); `--commit` aplica; `--only=prefixo` restaura um subconjunto. Faz `SET` por cima do Redis atual, não apaga chaves ausentes no dump. (A URL crua do blob privado não abre por fetch sem token — use o arquivo local.)
- **Setup no Vercel** (uma vez): criar Blob Store no painel (gera `BLOB_READ_WRITE_TOKEN`); definir `BACKUP_ENCRYPTION_KEY` e `CRON_SECRET`. Plano Hobby permite cron 1×/dia — suficiente.
- ⚠ Guarde a `BACKUP_ENCRYPTION_KEY` **também fora do Vercel** (gerenciador de senhas): se o projeto Vercel for perdido junto com a chave, os dumps ficam irrecuperáveis.

---

## Migração futura (PostgreSQL / Turso)

`_arquivo/planejamento/db/schema.sql` é o schema Postgres planejado, mas está **desatualizado** vs. o estado atual: não tem `schedule_overrides` nem `ch_closed`, modela `shift_params` por mês e persistência de SA (que hoje é calculado, não gravado), e assume um fluxo de auth (ProfileSetup/tabela `users`) substituído pela allowlist. Antes de migrar, o schema precisa ser reescrito para o estado atual. Turso (libSQL) é alternativa viável e sem dor de connection-pool em serverless; migração é read-only na fonte (Redis intactos) + verificação + cutover — risco de perda quase nulo. O dump do backup serve de entrada para o script de migração.

---

## Regras de Manutenção

- **Documentação**: atualizar este `CLAUDE.md` sempre que uma função ou ponto central mudar.
- **Allowlist**: editar apenas `api/_allowlist.js`. Não armazenar e-mails em nenhum outro lugar.
- **Repositório**: DEVE ser privado — contém e-mails da equipe em `_allowlist.js`.
- **Segredos**: `.env.local` nunca commitado. `CLERK_SECRET_KEY` só no Vercel.
- **Erros ao cliente**: sempre genéricos (`"Unauthorized"`, `"Forbidden"`, `"Internal error"`). Detalhes só no `console.error`.
- **API helpers privados**: `api/_*.js` (prefixo `_`) não são expostos pelo Vercel como rotas públicas.
- **Postgres/Turso**: `_arquivo/planejamento/db/schema.sql` é planejamento futuro e está desatualizado (ver Migração futura). Não há migrations em execução.
- **Backup**: nunca commitar dumps nem a `BACKUP_ENCRYPTION_KEY`. Alterou a estrutura de dados? O backup (`SCAN`) segue funcionando, mas confira se o `scripts/restore-backup.mjs` ainda restaura corretamente.
- **Arquivo histórico**: `_arquivo/legado-standalone/` contém a versão antiga standalone (index.html + CDN + pywebview). `_arquivo/planejamento/` contém o schema PostgreSQL futuro. Não alterar — apenas para registro.
