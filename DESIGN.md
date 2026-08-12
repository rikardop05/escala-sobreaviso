# Design — Escala de Sobreaviso

Sistema visual **como construído** (não como pretendido). Fonte de verdade em código:
[`src/lib/theme.js`](src/lib/theme.js) para tokens, [`src/components/ui.jsx`](src/components/ui.jsx)
para primitivas, [`src/index.css`](src/index.css) para base e motion.

O contrato da direção fica no `<body>` de [`index.html`](index.html) e sobrevive ao build de
produção (confirmado: `grep 6b07756e dist/index.html`).

---

## Registro

**Console de operação.** Régua de acabamento declarada em [PRODUCT.md](PRODUCT.md): **Grafana e
Datadog**. Escolha do dono do produto após recusar duas rodadas de direções alternativas — a
convenção da categoria é o compromisso, não uma falta de ambição. Não reabrir sem pedido.

O que o registro obriga, e que a versão anterior não cumpria:

| Regra | Antes | Agora |
|---|---|---|
| Cinzas **neutros** | rampa slate do Tailwind (`#0F172A`/`#1E293B`), puxando azul | grafite com viés frio mínimo (`#0E0F12`/`#15171B`) |
| Cor saturada = informação | acento índigo `#6366F1` decorativo + gradiente no cabeçalho | acento só em interação; semântico só em estado; matiz só em pessoa |
| Hairline como estrutura | cards flutuantes com borda + sombra | 1px hairline; sombra **só** em overlay |
| Numeral tabular | nenhum | todo valor de hora e dinheiro |
| Raio contido | `rounded-2xl` (16px) + pílula em todo controle | 3/5/8px; pílula só em contador |

---

## Cor

### Superfícies

| Token | Escuro | Claro |
|---|---|---|
| `pageBg` | `#0E0F12` | `#F4F5F7` |
| `surface` | `#15171B` | `#FFFFFF` |
| `surfaceAlt` (fim de semana, linha alternada) | `#1A1D22` | `#F8F9FA` |
| `surfaceSunken` (calha de data, input) | `#0B0C0F` | `#F1F2F4` |
| `border` | `#24272E` | `#DFE1E6` |
| `borderStrong` | `#343941` | `#C3C7CE` |

### Texto

| Token | Escuro | Claro | Contraste sobre `surface` |
|---|---|---|---|
| `textPrimary` | `#E7E9EC` | `#1A1D23` | 13,6:1 · 15,9:1 |
| `textSecondary` | `#B3B8C0` | `#454B54` | 8,0:1 · 8,6:1 |
| `textMuted` | `#949AA4` | `#565D69` | 6,5:1 · 6,7:1 |

⚠ **`textMuted` tem folga de propósito.** O valor anterior (`#878D96`) passava com 4,9:1 sobre
`surface` pura, mas caía para **4,33:1** sobre a linha *tingida* de hoje (`accentQuiet` composto
sobre a superfície) — abaixo de AA. Medido no DOM, não estimado. **Um token de texto precisa passar
no pior fundo em que é usado, não no melhor.** Ao mexer nele, reveja sobre a linha de hoje.

### Acento e estado

O acento existe em **dois pesos**, porque um só não serve para texto e para preenchimento:

- `accent` — texto, borda, indicador (claro o bastante para AA sobre fundo escuro)
- `accentFill` + `accentInk` — preenchimento de botão (fundo o bastante para tinta branca em cima)
- `accentQuiet` / `accentBorder` — tinta da própria matiz em alpha baixo

| Papel | Escuro | Claro | Uso |
|---|---|---|---|
| `accent` | `#5B95F5` | `#1D5FBF` | interação, seleção, hoje |
| `success` | `#5FBF7A` | `#1F7A3D` | aprovado, mês fechado, salvo |
| `warn` | `#E5A54B` | `#9A6206` | pendente, turno vago, sobreposição parcial |
| `danger` | `#F2707A` | `#C0261F` | rejeitado, erro, mesma pessoa sobreposta |
| `info` | `#63B3ED` | `#1F6FA8` | sobreaviso automático, substituição ativa |

Cada um tem `…Quiet` (fundo) e `…Border`. **Nunca** hex de estado escrito à mão num componente:
era exatamente o defeito antigo (`#FEF9C3` com texto `#854D0E`, valores de tema claro, renderizados
no escuro).

⚠ **Verde não é navegação.** `success` significa estado positivo. "Relatório consolidado" e
"Exportar CSV" eram botões verdes preenchidos e passaram a `secondary` — verde ali prometia
"deu certo" para uma ação que só troca de vista.

### Cor por pessoa — matiz, não hex

Cor por pessoa é **intocável** por decisão do dono ([PRODUCT.md](PRODUCT.md)). A implementação
mudou: cada pessoa carrega só uma **matiz** (`hue`, 0–360, em [`src/lib/teams.js`](src/lib/teams.js))
e o tom concreto sai de `memberTone(name, dark)` em OKLCH com **lightness e chroma fixos**:

```
escuro: oklch(0.79 0.11 <hue>)   tinta do chip: mesma matiz @ 16%
claro:  oklch(0.45 0.13 <hue>)   tinta do chip: mesma matiz @ 10%
```

Porque a lightness é constante, **as 19 pessoas têm o mesmo contraste contra o mesmo fundo**. Não
existe mais "a cor do Antonio some no escuro" — o que acontecia com as cores Material 2014 antigas
(`#424242` sobre card escuro era praticamente invisível; `#00695C`, `#4E342E`, `#283593` também
falhavam). Adicionar alguém = escolher uma matiz.

Matizes espalhadas **dentro de cada equipe** (não 19 únicas globais): você só vê o roster de uma
equipe por vez, exceto no widget "Agora", onde o nome da equipe acompanha cada linha e a cor não é
o único diferenciador. Vizinhos na mesma equipe ficam a ≥40° um do outro.

`memberTone` retorna `{ ink, tint, dot, hue }`. **Nunca** ler `MEMBERS[x].color`/`.bg` para estilo
(os campos sobrevivem só por compatibilidade).

---

## Forma

```
rChip    3px   badge, etiqueta de tipo, chip de pessoa
rControl 5px   botão, input, segmented, cartão de total
rPanel   8px   painel, modal, tabela
rPill    9999  SÓ contador pequeno (ex.: "1" em Verificar pendências)
```

**Elevação é declarada uma vez.** Painel tem borda e nenhuma sombra; overlay tem sombra e nenhuma
borda. Borda de 1px sob sombra larga é o *ghost card* e não existe mais aqui — o painel sticky de
edição e os modais carregavam os dois ao mesmo tempo.

`shadowOverlay` tem deslocamento **e** blur (`0 12px 32px -8px …`), nunca um halo de deslocamento
zero.

---

## Tipografia

Stack de sistema, **sem webfont** — o app não carrega fonte externa e o registro de console é bem
servido por uma workhorse de UI. `fontMono` para horários, durações e valores em coluna.

`font-variant-numeric: tabular-nums` via `.tnum` em **todo** número de dado. Em ferramenta
financeira isto não é refinamento: sem largura fixa de dígito uma coluna de valores não alinha e o
olho perde a comparação linha a linha.

Título de tela: 1,15rem / 700 / tracking −0,01em. Nada de display grande — é ferramenta, não
vitrine. **Sem eyebrow/kicker acima de título** em nenhuma tela.

---

## Composição

**Tela grande vence** (decisão registrada em PRODUCT.md). A aba Escala é uma grade de duas colunas
a partir de `lg`:

- **Coluna principal** — barra de ferramentas (equipe segmentada, meses, editar), título do mês, o
  calendário, substituições, painel sticky de edição.
- **Barra lateral fixa, 21rem** — "Agora" (as três equipes + passagem de turno), filtro por
  responsável, próximos plantões da pessoa filtrada.

Abaixo de `lg` empilha e o "Agora" vai para cima, que é a ordem certa no celular.

### O calendário é uma tabela, não 30 cards

A mudança estrutural mais importante: um **painel único com linhas separadas por hairline**, em vez
de 30 cards flutuantes com gap. Estes dados *são* tabulares — dias em linhas, turnos dentro da
linha. Ganha densidade (restrição fixada pelo dono) e calma ao mesmo tempo, e mata o reflexo de
grade de cards.

- **Hoje**: fundo `accentQuiet` + número em `accent` + rótulo "HOJE". **Não** uma faixa lateral
  colorida — `border-left` acima de 1px é o tell mais reconhecível de UI gerada e está banido.
- **Fim de semana**: `surfaceAlt`.
- **Passado**: opacidade 0,5. **Filtrado fora**: 0,32.
- Turnos ordenados por horário real de início (`sortShiftsByStart`) — `idx` é só a chave estável do
  override, nunca a posição.

---

## Motion

**Um** momento autoral: `.settle-in` (420ms, `cubic-bezier(0.16, 1, 0.3, 1)` — ease-out
exponencial) nas linhas do "Agora" quando o dado chega. Parte de um estado **já visível** — nunca
gating de visibilidade por classe, porque em aba oculta a transição não dispara e a seção embarcaria
em branco.

Removido: o `animate-ping` no ponto do plantão. Era efeito ambiente espalhado. No lugar entrou
**informação** — a hora a que a leitura se refere (`Qua 12/08 · 15:20`) no cabeçalho do painel.
Numa ferramenta de plantão isso responde "esse dado está fresco?" melhor que uma animação.

`prefers-reduced-motion` desliga tudo, inclusive `scroll-behavior`.

---

## Primitivas ([`src/components/ui.jsx`](src/components/ui.jsx))

| Componente | Papel |
|---|---|
| `Button` | `primary` \| `secondary` \| `quiet` \| `danger`; `sm` \| `md`. Desabilitado baixa a opacidade do controle, **não** pinta fundo cinza com texto apagado (esse par dava 4,47:1) |
| `Badge` | `accent` \| `success` \| `warn` \| `danger` \| `info` \| `neutral` |
| `Segmented` + `SegmentedItem` | substitui fileira de pílulas (equipe, mês) |
| `Panel` | borda, sem sombra — a regra de elevação num componente |
| `SectionLabel` | rótulo de seção em caixa alta discreta |
| `Icon` | 19 SVGs, traço 2px, cap redondo, um só peso. Nunca emoji como ícone |

`Button`/`Badge`/`Panel` foram extraídos porque o app repetia o mesmo botão inline em ~40 lugares,
cada um com raio, padding e peso ligeiramente diferentes.

---

## Verificação corrente

- **Detector**: `node .agents/skills/impeccable/scripts/detect.mjs --json src/components src/lib src/App.jsx src/index.css` → `[]`
- **Contraste**: 0 falhas de AA medidas no DOM em 6 combinações (Escala, Controle de Horas,
  Estrutura × escuro e claro). O auditor resolve `oklch()` via canvas — um checador que só faz
  parse de `rgb()` reporta as cores por pessoa como falso positivo.
- **Build**: `npx vite build` limpo; contrato de direção presente em `dist/index.html`.

⚠ **O que não foi verificado visualmente**: `RelatorioConsolidado` com dados reais de várias
pessoas, o modo de edição da escala (seleção, dividir turno, aplicar a meses futuros), o fluxo de
fechamento de mês e os estados de erro de rede. Todos exigem sessão autenticada e backend — sob
`vite dev` as funções da Vercel não executam (o servidor entrega o código-fonte de `api/*.js`).
Foram conferidos por leitura de código e tokens, não por render.
