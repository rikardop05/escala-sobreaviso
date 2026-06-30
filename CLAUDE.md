# Escala de Sobreaviso — Documentação de Projeto

App interno da MT Fintech para a equipe de sobreaviso (6 pessoas).
Gerencia o calendário de plantões e o controle financeiro de horas.

**URL em produção**: https://escala-sobreaviso.vercel.app
**Repo**: https://github.com/rikardop05/escala-sobreaviso

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
  App.jsx                   Guard de auth, ProfileSetup, navegação por abas
  index.css                 Tailwind directives
  lib/
    api.js                  Hook useApi() — fetch autenticado com JWT Clerk
    schedule.js             Toda a lógica de geração da escala (leia seção Escala abaixo)
  components/
    EscalaSobreaviso.jsx    Calendário mensal, filtro por pessoa, painel de substituições
    ControleDeHoras.jsx     CH: parâmetros, lançamentos HE/Comp, relatório, exportação CSV

api/
  _auth.js                  requireUser(req) — verificação real do JWT via @clerk/backend
  _redis.js                 kvGet / kvSet — helpers JSON sobre ioredis
  profile.js                GET/POST perfil do usuário autenticado
  substitutions.js          GET/POST/DELETE substituições (dado compartilhado entre todos)
  ch.js                     GET/POST lançamentos e parâmetros CH (isolado por userId)

db/
  schema.sql                Schema PostgreSQL — target da migração futura; não está em uso

vercel.json                 SPA rewrite: qualquer rota não-/api/* → /index.html
```

---

## Regras de Negócio — Escala

### Equipe (`src/lib/schedule.js`)

```js
PEOPLE    = { Emanoel, "Marcus Túlio", Ricardo, Carlos, Raul, Alice }
CH_NAMES  = ["Raul", "Emanoel", "Marcus Túlio", "Ricardo", "Carlos"]
// Alice não participa do Controle de Horas financeiro
```

### Turnos de semana (seg–sex) — `WEEKDAY_SHIFTS`

Cada dia da semana tem 3 turnos fixos:

| Turno | Horário | Duração |
|-------|---------|---------|
| Madrugada | 23:00 – 04:00 | 5h |
| Manhã | 04:00 – 09:00 | 5h |
| Noite | 18:00 – 23:00 (sexta: 24:00) | 5h / 6h |

A atribuição de pessoa por turno por dia está em `WEEKDAY_SHIFTS[dow]`.

### Fins de semana — `WEEKEND_CYCLE` (5 semanas de rotação)

Cada sábado inicia um ciclo de 2 dias (sáb + dom).

```
Dia  (sáb/dom): 00:00 – 12:00  (12h)
Noite (sáb/dom): 12:00 – 00:00 (12h)
Folga FDS: um membro diferente por semana
```

**Algoritmo `cycleIndex(saturday)`:**
```js
diff  = (saturday - ANCHOR) / (7 dias)   // semanas desde o âncora
index = ((diff % 5) + 5) % 5             // sempre positivo, mesmo para datas anteriores ao âncora
```

**`ANCHOR = 2026-06-13`** — o sábado que corresponde à Semana 1 do ciclo.
⚠️ Alterar o ANCHOR invalida toda a escala histórica e futura.

**`RANGE_START = 2026-06-08`** / **`RANGE_END = 2027-06-30`** — período gerado por `buildSchedule()`.
Estender o range requer apenas atualizar `RANGE_END`.

### Substituições

`getActiveSub(person, dateStr, subs)` busca em `subs` a primeira entrada onde:
- `s.titular === person`
- `dateStr >= s.from && dateStr <= s.until`

Se encontrar, o plantão do `titular` passa a ser exibido com o nome do `substituto`.
A lista `subs` é compartilhada (todos veem as mesmas substituições).

---

## Controle de Horas (CH)

### Acesso

Apenas membros cujo `profile.memberId` está em `CH_NAMES` veem a aba CH.
Visitantes (memberId ausente) e Alice não têm acesso.

### Entradas automáticas (SA)

`scheduleEntries` em `ControleDeHoras.jsx` deriva os turnos SA direto de `buildSchedule()`,
filtrado por `person` + `month` + substituições ativas. O usuário não precisa lançar SA manualmente.

### Entradas manuais (HE e Compensação)

Formulário só oferece "Hora Extra" e "Compensação". SA não pode ser criado manualmente.
Armazenados em Redis como array JSON por usuário.

### Cálculo financeiro

```
valorHora       = remuneracao / jornada
valorSobreaviso = (valorHora / 3)   × horasSA   ← adicional de 1/3
valorHoraExtra  = (valorHora × 1.5) × horasHE   ← adicional de 50%
valorTotal      = valorSobreaviso + valorHoraExtra
```

### Exportação CSV

UTF-8 BOM (`﻿`) para compatibilidade com Excel. Separador `;`. Inclui seção de resumo financeiro ao final.

---

## Autenticação

### Fluxo completo

```
Browser → Clerk (Google OAuth) → JWT
    ↓
useApi() [src/lib/api.js]
  getToken() → Bearer <JWT>
  fetch(/api/*)
    ↓
requireUser(req) [api/_auth.js]
  verifyToken(token, options)   ← assinatura + emissor + expiração
  return { userId: payload.sub }
    ↓
Handler usa userId para isolar dados no Redis
```

### Opções de verificação em `_auth.js`

| Variável de ambiente | Comportamento |
|---------------------|---------------|
| `CLERK_JWT_KEY` (PEM) | Verificação local, sem chamada de rede — **preferido para serverless** |
| `CLERK_SECRET_KEY` | Busca JWK no cold start (~100 ms extra), depois usa cache da instância |

Se nenhuma estiver definida, `verifyToken` lança e o endpoint retorna 401.

### Profile e localStorage

`App.jsx` usa localStorage (`escala_profile_{userId}`) como cache para evitar flicker:

1. Montagem: lê localStorage → se tem dados, mostra o app imediatamente (sem tela de loading)
2. GET `/api/profile` em background sempre acontece
3. Se servidor retorna `memberId !== undefined` → atualiza localStorage
4. Se servidor falha e localStorage tem dados → mantém o cache (resiliente a falhas de API)
5. Se localStorage vazio e servidor falha → mostra ProfileSetup

### ProfileSetup

Primeira vez que o usuário autentica, ele escolhe seu nome da equipe.
A escolha é **permanente** (sem troca via app). Salva em Redis e localStorage.
Visitantes escolhem "Só visualizar" — recebem `memberId: null`.

---

## Redis — Chaves e Formato

| Chave | Formato | Proprietário |
|-------|---------|--------------|
| `user:{clerkId}:profile` | `{ memberId, dark, filter, monthKey }` | Por usuário |
| `user:{clerkId}:ch_entries` | `[{ id, person, tipo, data, inicio, fim, projeto, atividade }]` | Por usuário |
| `user:{clerkId}:ch_params` | `{ [memberId]: { remuneracao, jornada } }` | Por usuário |
| `substitutions` | `[{ id, titular, substituto, from, until }]` | Compartilhado |

`kvGet` retorna `null` se a chave não existir (não lança). `kvSet` serializa para JSON string.

---

## Variáveis de Ambiente (Vercel)

| Variável | Origem | Uso |
|----------|--------|-----|
| `REDIS_URL` | Auto-injetada ao conectar Vercel KV | ioredis connection |
| `CLERK_JWT_KEY` | Clerk Dashboard → API Keys → JWT Public Key | Verificação JWT sem rede |
| `CLERK_SECRET_KEY` | Clerk Dashboard → API Keys | Verificação JWT com JWK fetch |

A publishable key Clerk (`pk_test_...`) está hardcoded em `src/main.jsx` — é pública por design
e termina no bundle independentemente; não há risco em deixá-la no código.

---

## Regras de Manutenção

- **Documentação**: atualizar este `CLAUDE.md` sempre que uma função ou ponto central mudar.
- **Commits**: mensagens em português, descritivas, com `Co-Authored-By: Claude Sonnet 4.6`.
- **Segredos**: `.env.local` nunca commitado (`.gitignore`). `CLERK_SECRET_KEY` só no Vercel.
- **API helpers privados**: arquivos `api/_*.js` (prefixo `_`) não são expostos pelo Vercel como rotas.
- **Erros ao cliente**: sempre genéricos (`"Unauthorized"`, `"Internal error"`). Detalhes só no `console.error`.
- **Schema SQL**: `db/schema.sql` é planejamento futuro. Não há migrations em execução.
