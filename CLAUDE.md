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
    schedule.js             Toda a lógica de geração da escala (leia seção Escala abaixo)
    theme.js                Tema unificado getTheme(dark) — tokens de cor AA usados pelos dois views (não criar temas locais)
  components/
    ui.jsx                  Kit compartilhado: Icon (SVGs), SaveStatus, Snackbar (undo), ConfirmDialog, Skeleton, friendlyError()
    EscalaSobreaviso.jsx    Calendário mensal, filtro, substituições, edição de escala (admin)
    ControleDeHoras.jsx     CH: parâmetros, lançamentos HE/Comp, relatório, exportação CSV; admin pode ver qualquer membro
    EstruturaEscala.jsx     Aba "Estrutura" (só admin, #estrutura): tabelas read-only da estrutura base — semana (WEEKDAY_SHIFTS) e escada de FDS (gerada de WEEKEND_ROSTER). Fase 1: só visualização; edição versionada é fase futura

api/
  _allowlist.js             EDITAR AQUI: mapeamento email→{memberId, role}; resolveAccess()
  _auth.js                  requireUser(req) — verifica JWT + busca email via Clerk API + resolve role
  _redis.js                 kvGet / kvSet / kvScanAll — helpers JSON sobre ioredis
  _backup-crypto.js         encrypt/decrypt AES-256-GCM dos dumps de backup (BACKUP_ENCRYPTION_KEY)
  profile.js                GET/POST preferências do usuário (dark, filter, monthKey); role/memberId vêm da allowlist
  substitutions.js          GET/POST/DELETE substituições; controle de acesso por role no backend
  ch.js                     GET/POST lançamentos e parâmetros CH; admin acessa qualquer membro
  ch-close.js               Fechamento mensal do CH: GET fechamentos; POST fecha mês (admin); DELETE reabre (admin)
  schedule.js               GET {overrides,labels} (público); POST overrides+labels (admin), carimba editedAt
  backup.js                 Cron diário: dump do Redis → cifra → Vercel Blob; poda >30 dias (ver Backup abaixo)

scripts/
  restore-backup.mjs        Restauração de um dump para o Redis (dry-run por padrão; --commit aplica)

_arquivo/planejamento/db/
  schema.sql                Schema PostgreSQL — planejamento; desatualizado vs. estado atual (ver Migração futura)

vercel.json                 SPA rewrite (rota não-/api/* → /index.html) + cron de backup (crons)

public/
  logo.png                  Ícone/marca do app (favicon + apple-touch-icon em index.html; mark na nav em App.jsx)
```

---

## Sistema de Acesso (Allowlist)

### Como configurar

Edite `api/_allowlist.js` — é o único arquivo que precisa ser alterado para adicionar/remover pessoas:

```js
export const ALLOWLIST = {
  'email@dominio.com.br': { memberId: 'Ricardo', role: 'member' },
  'admin@dominio.com.br': { memberId: 'Ricardo', role: 'admin'  },
};
```

Regras:
- `memberId` **deve bater exatamente** com uma chave de `PEOPLE` em `src/lib/schedule.js`
- E-mails são comparados em lowercase (case-insensitive)
- Qualquer e-mail fora da lista → `role: 'viewer'` automático (sem CH, sem edição)

### Roles e permissões

| Role | Escala | Substituições | CH | Editar Escala |
|------|--------|---------------|----|---------------|
| público (sem login) | Leitura | Leitura | — | — |
| `viewer` | Leitura | Leitura | — | — |
| `member` | Leitura | Criar/deletar quando for titular ou substituto | Próprio painel | — |
| `admin` | Leitura | Qualquer | Todos os painéis | Sim |

**GET `/api/schedule` e GET `/api/substitutions` são públicos** — retornam dados sem autenticação para suportar a visualização pública.
Escrita (POST/DELETE) sempre requer auth; CH (`/api/ch`) sempre requer auth.

**Toda autorização de escrita é garantida no backend** (`requireUser` retorna role da allowlist, nunca do cliente).

### Como `requireUser` funciona

1. Extrai Bearer token do header `Authorization`
2. `verifyToken(token, options)` — verifica assinatura, emissor, expiração. Lança 401 em falha.
3. Resolução de e-mail (dois caminhos, ordem de preferência):
   - **Estratégia 1 — payload JWT**: lê `payload.email` se presente (sem network). Requer configurar o JWT template no Clerk Dashboard → JWT Templates → Default → adicionar `{ "email": "{{user.primary_email_address}}" }`.
   - **Estratégia 2 — Clerk Users API**: `clerkClient.users.getUser(userId)`. Requer `CLERK_SECRET_KEY` no Vercel.
   - Se nenhuma funcionar: e-mail fica `null`, usuário recebe `role: 'viewer'` automaticamente (sem 401). O log do servidor mostrará o erro.
4. `resolveAccess(email)` — cruza com a allowlist
5. Retorna `{ userId, email, memberId, role }`

---

## Regras de Negócio — Escala

### Equipe (`src/lib/schedule.js`)

```js
PEOPLE    = { Emanoel, "Marcus Túlio", Ricardo, Carlos, Raul, Alice }
CH_NAMES  = ["Raul", "Emanoel", "Marcus Túlio", "Ricardo", "Carlos", "Alice"]
// Todos os membros participam do Controle de Horas (Alice incluída em jul/2026)
```

### Turnos de semana (seg–sex) — `WEEKDAY_SHIFTS`

Cada dia da semana tem 3 turnos fixos:

| Turno | Horário | Duração |
|-------|---------|---------|
| Madrugada | 23:00 – 04:00 | 5h |
| Manhã | 04:00 – 09:00 | 5h |
| Noite | 18:00 – 23:00 (sexta: 24:00) | 5h / 6h |

### Fins de semana — rotação com vigência por data

```
Dia  (sáb/dom): 23:00 (véspera) – 11:00  (12h)  ← handoff às 23:00, igual aos dias úteis
Noite (sáb/dom): 11:00 – 23:00 (12h)
```
Handoff fixo às 23:00/11:00: Sex→Sáb→Dom→Seg conectam sem exceção (a Madrugada de
segunda começa 23:00 do domingo). Durações seguem 12h → **sem impacto financeiro**,
por isso a mudança de horário vale para toda a faixa. `buildOnCallSegments` trata
`idx 0` que começa à noite e cruza a meia-noite (Madrugada útil E Dia do FDS) como
pernoite que pertence à véspera.

`weekendAssignment(saturday)` escolhe a rotação pela data do sábado e sempre retorna `folga` como **array**:

- **FDS antes de `WEEKEND_CHANGE` (2026-07-18)** → `WEEKEND_CYCLE` antigo: 5 semanas, 5 pessoas, **1 folga** (Alice não faz FDS). `ANCHOR = 2026-06-13`, `cycleIndex` via `((diff % 5)+5)%5`. Mantido para preservar histórico/folha.
- **FDS a partir de `WEEKEND_CHANGE`** → **escada de 6 semanas** GERADA de `WEEKEND_ROSTER = [Alice, Emanoel, Ricardo, Raul, Marcus Túlio, Carlos]`: cada pessoa avança uma estação por semana nas estações `[Sáb Dia, Sáb Noite, Dom Dia, Dom Noite, Folga, Folga]` → 4 trabalham + **2 folgam**. Fórmula: `estação s na semana w = roster[(s-w) mod 6]`. A ordem foi derivada por **continuidade** com o ciclo antigo (último FDS 11–12/07): quem folgou continua folgando na virada, Alice entra no Sáb Dia, os demais só avançam.

⚠️ Mover `WEEKEND_CHANGE`, `ANCHOR` ou `WEEKEND_ROSTER` recalcula a escala (histórico e futuro). Meses de CH fechados ficam protegidos pelos snapshots; meses abertos recalculam.

**`RANGE_START = 2026-06-08`** / **`RANGE_END = 2027-06-30`** — período gerado por `buildSchedule()`. Para estender: atualizar apenas `RANGE_END`.

`day.folga` é **sempre array** (vazio em dia útil; 1 nome no ciclo antigo; 2 na escada nova) — a UI usa `d.folga.includes(...)` / `d.folga.join(', ')`.

### Overrides de escala (admin)

`buildSchedule(overrides = {}, labels = {})` aceita overrides por dia/índice e rótulos por dia:
```js
// overrides: { 'YYYY-MM-DD': { '0': { persons:['Ricardo'], period, time, dur }, '1': null } }
//   null = revert para base (num índice extra, remove o turno)
//   índice além dos turnos base (ex.: '3') vira um turno NOVO — dias custom/feriado
//   persons: string[] (multi-pessoa). person (string) ainda é aceito como legado.
// labels: { 'YYYY-MM-DD': 'Feriado' } — rótulo opcional do dia
```

Cada turno retornado carrega um `idx` **estável** (a chave do override), usado pela UI para seleção/edição/remoção — não confie na posição no array. Use `shiftPeople(shift)` (não `shift.person`) para ler as pessoas de um turno em qualquer lugar.

Overrides e labels ficam em chaves globais no Redis (`schedule_overrides`, `schedule_labels`). O admin edita no modo de edição do calendário: seleciona turnos + form (multi-seleção de pessoas), **"+ Adicionar turno"** por dia (feriados), reset (remove turno extra) e um input de **rótulo do dia**. POST `/api/schedule` com `{ overrides?, labels? }`.

**Carimbo de edição**: ao aplicar o patch, `api/schedule.js` adiciona `editedAt` (ISO) a cada override não-nulo (só data, sem autor). O cliente usa isso para um marcador **"alterado dd/mm" que expira após 14 dias** (`EDIT_RECENT_MS` em `EscalaSobreaviso.jsx`). No modo de edição, todos os overrides ficam destacados (gerenciamento).

O widget "Agora" usa `currentOnCall(now, schedule, subs)` e `adjacentOnCall(now, schedule, subs)` — ambos derivam de `buildOnCallSegments(schedule)`, que calcula os blocos de plantão a partir do **`shift.time` real** (não de janelas fixas), preservando a convenção de atribuição de dia (Madrugada pernoita na véspera; segunda começa 00:00; sexta até 24:00). Assim, edições de horário e turnos de feriado são refletidos, e o "Agora" mostra **todas** as pessoas quando o turno é multi-pessoa.

### Substituições

`getActiveSub(person, dateStr, subs)` → busca substituição ativa onde `titular === person` e `dateStr` está no período.
Lista `subs` é compartilhada (todos veem as mesmas substituições via chave global Redis).

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
```

SA vem de `buildSchedule(overrides, labels)` — reflete edições do admin no cálculo e no CSV. O `scheduleEntries` casa a pessoa via `shiftPeople(shift)`, então em turno multi-pessoa (feriado) **cada** pessoa ganha seu próprio SA pelas horas do turno.

### Fechamento mensal (folha de pagamento)

Sem fechamento, os valores são recalculados a cada render — editar remuneração/escala muda meses passados retroativamente. O fechamento congela o mês:

- **Fechar mês** (só admin, botão no Relatório): grava snapshot imutável `{ closedAt, closedBy, params, totals, entries[] }` em `member:{id}:ch_closed[YYYY-MM]`. Recusa fechar mês já fechado (409).
- **Mês fechado**: relatório, ledger e CSV usam o snapshot (badge "Mês fechado" + "congelados"); novos lançamentos com data nesse mês são bloqueados no cliente; botões editar/excluir somem. Parâmetros continuam editáveis — só afetam meses abertos.
- **Reabrir** (só admin): descarta o snapshot; valores voltam a ser recalculados.
- Totais são calculados no cliente (lógica da escala vive em `src/lib/schedule.js`, fronteira Vite/Node impede import no `api/`); o snapshot é validado por schema e a ação é exclusiva de admin — congela o que o admin viu e aprovou na tela.
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
| `substitutions` | `[{ id, titular, substituto, from, until }]` | Compartilhado |
| `schedule_overrides` | `{ [dayKey]: { [idx]: { persons[]?|person?, period, time, dur, editedAt } } }` (idx extra = turno novo) | Compartilhado |
| `schedule_labels` | `{ [dayKey]: string }` — rótulo do dia (ex.: "Feriado") | Compartilhado |

O backup faz `SCAN` de **todas** as chaves (não depende desta lista) — chaves novas entram no dump automaticamente.

---

## Validação de Input (Zod)

`api/_validate.js` centraliza todos os schemas Zod e os helpers `validate()` / `checkBodySize()`.

| Endpoint | Schema |
|----------|--------|
| `schedule` GET | Público — retorna `{ overrides, labels }`. |
| `schedule` POST | `SchedulePostSchema` — `{ overrides?, labels? }`. `overrides` = `SchedulePatchSchema` (record `dayKey → idx → OverrideObj | null`; `OverrideObj` tem `person?`/`persons[]?` validados contra a equipe, índices extras permitidos). `labels` = `LabelPatchSchema` (`dayKey → string | null`). Aceita também um patch cru (compat.). |
| `substitutions` POST | `SubPostSchema` — campos obrigatórios tipados; `until >= from`; `titular ≠ substituto`. |
| `substitutions` DELETE | `id` query string não-vazia (checagem inline). |
| `ch` POST | `ChPostSchema` — `entries[]` (com `tipo` enum), `params` record, `person` string. Todos opcionais. |
| `ch-close` POST | `ChClosePostSchema` — `person` (enum equipe, opcional), `month` YYYY-MM, `snapshot` { params, totals, entries[] ≤200 }. |
| `ch-close` DELETE | `month` validado como YYYY-MM (`ChCloseMonthQuery`). |

Ordem de execução: `requireUser` → checagem de role → `checkBodySize` (50 KB) → `validate(schema)` → Redis.
Erros de validação: log server-side dos primeiros 5 issues; resposta sempre `400 { error: 'Bad request' }`.

Ao adicionar membros à equipe em `_allowlist.js`, atualizar também `TEAM_MEMBERS` em `api/_validate.js`.

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
