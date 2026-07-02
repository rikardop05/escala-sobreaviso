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

api/
  _allowlist.js             EDITAR AQUI: mapeamento email→{memberId, role}; resolveAccess()
  _auth.js                  requireUser(req) — verifica JWT + busca email via Clerk API + resolve role
  _redis.js                 kvGet / kvSet — helpers JSON sobre ioredis
  profile.js                GET/POST preferências do usuário (dark, filter, monthKey); role/memberId vêm da allowlist
  substitutions.js          GET/POST/DELETE substituições; controle de acesso por role no backend
  ch.js                     GET/POST lançamentos e parâmetros CH; admin acessa qualquer membro
  schedule.js               GET/POST overrides de escala; POST bloqueado para não-admin

db/
  schema.sql                Schema PostgreSQL — target da migração futura; não está em uso

vercel.json                 SPA rewrite: qualquer rota não-/api/* → /index.html
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

### Fins de semana — `WEEKEND_CYCLE` (5 semanas de rotação)

```
Dia  (sáb/dom): 00:00 – 12:00  (12h)
Noite (sáb/dom): 12:00 – 00:00 (12h)
Folga FDS: um membro diferente por semana
```

**`ANCHOR = 2026-06-13`** — o sábado que corresponde à Semana 1 do ciclo.
⚠️ Alterar ANCHOR invalida toda a escala histórica e futura.

**`RANGE_START = 2026-06-08`** / **`RANGE_END = 2027-06-30`** — período gerado por `buildSchedule()`.
Para estender: atualizar apenas `RANGE_END`.

**`cycleIndex(saturday)`** → index 0–4 via `((diff % 5) + 5) % 5`. O `+5` garante resultado positivo para datas anteriores ao ANCHOR.

### Overrides de escala (admin)

`buildSchedule(overrides = {})` aceita um objeto de overrides:
```js
// { 'YYYY-MM-DD': { '0': { person, period, time, dur }, '1': null } }
// null = revert para base
```

Overrides são persistidos em Redis na chave global `schedule_overrides`.
O admin edita via UI (modo edição no calendário) → POST `/api/schedule`.
Todos os componentes que usam `buildSchedule()` recebem os overrides para consistência financeira.

O widget "Agora" (`currentOnCall(now, schedule)`) recebe o array já construído por `buildSchedule(overrides)`, portanto reflete overrides do admin.

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

SA vem de `buildSchedule(overrides)` — reflete edições do admin no cálculo e no CSV exportado.

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
| `substitutions` | `[{ id, titular, substituto, from, until }]` | Compartilhado |
| `schedule_overrides` | `{ [dayKey]: { [shiftIdx]: { person, period, time, dur } } }` | Compartilhado |

---

## Validação de Input (Zod)

`api/_validate.js` centraliza todos os schemas Zod e os helpers `validate()` / `checkBodySize()`.

| Endpoint | Schema |
|----------|--------|
| `schedule` POST | `SchedulePatchSchema` — record `dayKey → shiftIdx ('0'|'1'|'2') → OverrideObj | null`. `person` validado contra nomes da equipe. |
| `substitutions` POST | `SubPostSchema` — campos obrigatórios tipados; `until >= from`; `titular ≠ substituto`. |
| `substitutions` DELETE | `id` query string não-vazia (checagem inline). |
| `ch` POST | `ChPostSchema` — `entries[]` (com `tipo` enum), `params` record, `person` string. Todos opcionais. |

Ordem de execução: `requireUser` → checagem de role → `checkBodySize` (50 KB) → `validate(schema)` → Redis.
Erros de validação: log server-side dos primeiros 5 issues; resposta sempre `400 { error: 'Bad request' }`.

Ao adicionar membros à equipe em `_allowlist.js`, atualizar também `TEAM_MEMBERS` em `api/_validate.js`.

---

## Padrões de UI (front)

- **Tema**: sempre via `getTheme(dark)` em `src/lib/theme.js`. Tokens cumprem WCAG AA; não criar dicionários de tema locais nos componentes.
- **Ícones**: SVGs do componente `Icon` em `src/components/ui.jsx` — nunca emoji como ícone.
- **Persistência com feedback**: toda escrita mostra estado (`SaveStatus`: Salvando…/Salvo/Erro com "Tentar de novo") e faz rollback do estado otimista em falha. Parâmetros do CH têm debounce de 600ms.
- **Exclusões**: otimistas com `Snackbar` de undo (~6s); nada de window.confirm. Ações em massa ("aplicar/resetar a todos os meses seguintes") pedem `ConfirmDialog`.
- **Erros ao usuário**: sempre via `friendlyError()` — mensagens em PT-BR com ação sugerida; detalhes só no console.
- **View por hash**: `#escala` / `#controle` — refresh preserva a aba; `document.title` acompanha.
- **monthKey salvo no passado é ignorado** na montagem — o app abre no mês atual.
- **Acessibilidade**: foco visível global via `:focus-visible` (index.css); alvos de toque ≥40–44px; seleção de turnos no modo edição usa role="checkbox" + teclado; `prefers-reduced-motion` respeitado.

---

## Regras de Manutenção

- **Documentação**: atualizar este `CLAUDE.md` sempre que uma função ou ponto central mudar.
- **Allowlist**: editar apenas `api/_allowlist.js`. Não armazenar e-mails em nenhum outro lugar.
- **Repositório**: DEVE ser privado — contém e-mails da equipe em `_allowlist.js`.
- **Segredos**: `.env.local` nunca commitado. `CLERK_SECRET_KEY` só no Vercel.
- **Erros ao cliente**: sempre genéricos (`"Unauthorized"`, `"Forbidden"`, `"Internal error"`). Detalhes só no `console.error`.
- **API helpers privados**: `api/_*.js` (prefixo `_`) não são expostos pelo Vercel como rotas públicas.
- **Postgres**: `db/schema.sql` é planejamento futuro. Não há migrations em execução.
- **Arquivo histórico**: `_arquivo/legado-standalone/` contém a versão antiga standalone (index.html + CDN + pywebview). `_arquivo/planejamento/` contém o schema PostgreSQL futuro. Não alterar — apenas para registro.
