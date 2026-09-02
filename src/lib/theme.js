// Sistema de tokens visuais — fonte única para os dois temas.
//
// Registro: console de operação (a régua declarada em PRODUCT.md é Grafana +
// Datadog). O que isso obriga, e que o tema anterior não cumpria:
//
//   1. Cinzas NEUTROS, não azul-marinho. O tema antigo usava a rampa slate do
//      Tailwind (#0F172A / #1E293B / #334155), que puxa forte para o azul e é
//      exatamente a paleta padrão de dashboard gerado. Aqui o fundo é grafite
//      com um viés frio mínimo, então a única cor saturada na tela é
//      informação: acento de interação, estado semântico, ou cor de pessoa.
//   2. Hairline de 1px como recurso estrutural dominante, sombra só em
//      overlay. Elevação é declarada UMA vez por elemento: painel tem borda e
//      nenhuma sombra; overlay tem sombra e nenhuma borda. Borda de 1px sob
//      sombra larga é o "ghost card" e não existe mais aqui.
//   3. Raio contido. Painel 8px, controle 5px, chip 3px. Pílula (9999px) ficou
//      reservada a contador pequeno — o app antigo usava pílula em todo botão,
//      filtro e aba, que é o que dava o ar de dashboard de marketing.
//   4. Nada de gradiente decorativo. O cabeçalho era um linear-gradient com
//      texto branco forçado nos DOIS temas, e por isso carregava uma dúzia de
//      rgba(255,255,255,x) hardcoded que ignoravam o tema. O cabeçalho agora é
//      uma superfície normal e usa os tokens de texto como todo o resto.
//
// Contraste: todo par texto/fundo abaixo cumpre WCAG AA (≥4.5:1 para texto
// pequeno, ≥3:1 para texto grande). Os valores conferidos estão comentados.

import { MEMBERS } from './teams';

// ─── COR POR PESSOA ──────────────────────────────────────────────────────────
// Cor por pessoa é intocável por decisão do dono do produto (PRODUCT.md), mas as
// matizes foram retunadas. As antigas eram Material Design 2014 em tom 700–900
// (#00695C, #4E342E, #424242…): desenhadas para fundo claro, e sobre card
// escuro falhavam contraste — #424242 sobre #1E293B era praticamente invisível.
//
// Agora cada pessoa carrega só uma MATIZ (`hue`, em teams.js) e o tom é derivado
// em OKLCH com lightness e chroma FIXOS. Como a lightness é constante, todas as
// 19 pessoas têm o mesmo contraste contra o mesmo fundo — não existe mais
// "a cor do Antonio some no escuro". Adicionar alguém é escolher uma matiz.
const TONE = {
  dark:  { l: 0.79, c: 0.11, tintAlpha: 0.16, tintL: 0.79, tintC: 0.11 },
  light: { l: 0.45, c: 0.13, tintAlpha: 0.10, tintL: 0.45, tintC: 0.13 },
};

const FALLBACK_HUE = 250;

/**
 * Tom de uma pessoa no tema atual.
 * @returns {{ink: string, tint: string, dot: string, hue: number}}
 *   ink  — texto/nome (contraste AA garantido sobre surface e pageBg)
 *   tint — fundo do chip (mesma matiz, alpha baixo — nunca um pastel de outro tema)
 *   dot  — o ponto de identificação; igual a ink, nomeado à parte porque é forma, não texto
 */
export function memberTone(name, dark) {
  const hue = MEMBERS[name]?.hue ?? FALLBACK_HUE;
  const t = dark ? TONE.dark : TONE.light;
  const ink = `oklch(${t.l} ${t.c} ${hue})`;
  return {
    hue,
    ink,
    dot: ink,
    tint: `oklch(${t.tintL} ${t.tintC} ${hue} / ${t.tintAlpha})`,
  };
}

// ─── COR POR COMPONENTE FINANCEIRO E POR EQUIPE ──────────────────────────────
// Mesmo princípio de memberTone() (matiz fixa, lightness/chroma fixos por tema),
// mas para dois domínios diferentes de identidade — o tipo de lançamento
// (Sobreaviso/Hora Extra/Compensação/Remuneração) e a equipe — usados pela
// visão de custo do relatório consolidado (RelatorioCusto.jsx) em barras e
// legendas, onde precisa de um preenchimento (`fill`) e uma variante de texto
// sobre fundo (`hueText`), não de um chip como memberTone. Viviam duplicados
// dentro de RelatorioCusto.jsx com constantes de L/C ligeiramente diferentes
// das de memberTone — achado do /impeccable critique — e foram trazidos pra cá
// como as fontes únicas dessas duas identidades, junto da de pessoa.
const COMPONENT_HUES = { remuneracao: 250, sobreaviso: 200, horaExtra: 142, compensacao: 70 };
const TEAM_HUES = { sustentacao: 220, desenvolvimento: 128, infra: 48 };

export function componentTone(kind, dark) {
  const hue = COMPONENT_HUES[kind] ?? FALLBACK_HUE;
  const l = dark ? 0.74 : 0.45;
  const c = dark ? 0.10 : 0.12;
  return { hue, fill: `oklch(${l} ${c} ${hue})`, hueText: `oklch(${dark ? 0.82 : 0.42} ${c} ${hue})` };
}

export function teamTone(teamId, dark) {
  const hue = TEAM_HUES[teamId] ?? FALLBACK_HUE;
  const l = dark ? 0.74 : 0.45;
  const c = dark ? 0.11 : 0.13;
  return { hue, fill: `oklch(${l} ${c} ${hue})`, hueText: `oklch(${dark ? 0.83 : 0.40} ${c} ${hue})` };
}

// ─── ACENTO E ESTADO ─────────────────────────────────────────────────────────
// O acento antigo era #6366F1 (indigo-500 do Tailwind), o acento mais genérico
// que existe em interface gerada. Aqui é um azul de infraestrutura, mais fundo e
// menos roxo, e existe em dois pesos: `accent` para texto/borda/indicador (claro
// o bastante para AA sobre fundo escuro) e `accentFill` para preenchimento de
// botão (fundo o bastante para AA com tinta branca em cima).

const DARK = {
  accent: '#5B95F5', accentFill: '#2C6BD6', accentInk: '#FFFFFF',
  success: '#5FBF7A', warn: '#E5A54B', danger: '#F2707A', info: '#63B3ED',
};
const LIGHT = {
  accent: '#1D5FBF', accentFill: '#1D5FBF', accentInk: '#FFFFFF',
  success: '#1F7A3D', warn: '#9A6206', danger: '#C0261F', info: '#1F6FA8',
};

// Exports legados — vários arquivos importam ACENT/DANGER/WARN como constante de
// módulo, de quando o app tinha um acento só para os dois temas. Mantidos com os
// valores do tema claro (o mais restritivo) para não quebrar import; código novo
// deve usar T.accent / T.danger / T.warn, que respeitam o tema.
export const ACCENT = LIGHT.accent;
export const DANGER = LIGHT.danger;
export const WARN   = LIGHT.warn;

// rgba a partir de hex, para os fundos "quiet" de badge — mesma matiz do texto,
// nunca um pastel emprestado do outro tema (era o defeito dos badges antigos:
// #FEF9C3 com texto #854D0E, valores de tema claro, renderizados no escuro).
function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function build(dark) {
  const S = dark ? DARK : LIGHT;
  const quiet = dark ? 0.15 : 0.10;
  const quietBorder = dark ? 0.35 : 0.28;

  const base = dark ? {
    dark: true,

    // Superfícies — grafite neutro, viés frio mínimo
    pageBg: '#0E0F12',
    surface: '#15171B',        // painel
    surfaceAlt: '#1A1D22',     // linha alternada / fim de semana
    surfaceSunken: '#0B0C0F',  // calha de data, input
    surfaceHover: '#1F2329',

    border: '#24272E',
    borderStrong: '#343941',

    // Texto sobre surface (#15171B):
    // #E7E9EC ≈ 13.6:1 · #B3B8C0 ≈ 8.0:1 · #949AA4 ≈ 6.5:1
    //
    // textMuted tem folga de propósito. Sobre surface pura, #878D96 dava 4,9:1 e
    // passava; mas sobre uma linha TINGIDA (a de hoje, com accentQuiet) o fundo
    // efetivo clareia e o mesmo cinza caía para 4,33:1 — abaixo de AA. Medido no
    // DOM, não estimado. O token precisa passar no pior fundo em que é usado, não
    // no melhor.
    textPrimary: '#E7E9EC',
    textSecondary: '#B3B8C0',
    textMuted: '#949AA4',

    skeletonBg: '#1F2329',
    scrollThumb: '#343941',
  } : {
    dark: false,

    pageBg: '#F4F5F7',
    surface: '#FFFFFF',
    surfaceAlt: '#F8F9FA',
    surfaceSunken: '#F1F2F4',
    surfaceHover: '#F1F2F4',

    border: '#DFE1E6',
    borderStrong: '#C3C7CE',

    // Texto sobre branco:
    // #1A1D23 ≈ 15.9:1 · #454B54 ≈ 8.6:1 · #565D69 ≈ 6.7:1
    // Mesma folga do tema escuro, e pelo mesmo motivo: o pior fundo é a linha
    // tingida de hoje, não o branco.
    textPrimary: '#1A1D23',
    textSecondary: '#454B54',
    textMuted: '#565D69',

    skeletonBg: '#E8EAED',
    scrollThumb: '#C3C7CE',
  };

  const t = {
    ...base,

    // ─── Semântico ───────────────────────────────────────────────────────────
    accent: S.accent,
    accentFill: S.accentFill,
    accentInk: S.accentInk,
    accentQuiet: tint(S.accent, quiet),
    accentBorder: tint(S.accent, quietBorder),

    success: S.success, successQuiet: tint(S.success, quiet), successBorder: tint(S.success, quietBorder),
    warn: S.warn,       warnQuiet: tint(S.warn, quiet),       warnBorder: tint(S.warn, quietBorder),
    danger: S.danger,   dangerQuiet: tint(S.danger, quiet),   dangerBorder: tint(S.danger, quietBorder),
    info: S.info,       infoQuiet: tint(S.info, quiet),       infoBorder: tint(S.info, quietBorder),

    // Tinta sobre preenchimento sólido de warn/danger — no escuro esses tons são
    // claros (feitos pra ler como TEXTO sobre superfície escura), então branco em
    // cima erra pro lado oposto do accentInk. Antes cada consumidor escrevia
    // `T.dark ? '#1A0E0F' : '#FFFFFF'` (e uma variante '#1A1206' pro warn) à mão,
    // duplicado em 3 lugares — achado do /impeccable critique.
    dangerInk: dark ? '#1A0E0F' : '#FFFFFF',
    warnInk:   dark ? '#1A1206' : '#FFFFFF',

    // ─── Forma ───────────────────────────────────────────────────────────────
    rChip: '3px',
    rControl: '5px',
    rPanel: '8px',
    rPill: '9999px', // só contador pequeno

    // ─── Elevação — declarada uma vez ────────────────────────────────────────
    // Painel: borda, sem sombra. Overlay: sombra (com deslocamento E blur, nunca
    // um halo de deslocamento zero), sem borda.
    shadowOverlay: dark
      ? '0 12px 32px -8px rgba(0,0,0,0.70), 0 4px 10px -4px rgba(0,0,0,0.50)'
      : '0 12px 32px -8px rgba(16,20,28,0.20), 0 4px 10px -4px rgba(16,20,28,0.12)',
    shadowPopover: dark
      ? '0 6px 18px -6px rgba(0,0,0,0.65)'
      : '0 6px 18px -6px rgba(16,20,28,0.16)',

    // ─── Tipografia ──────────────────────────────────────────────────────────
    fontSans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontMono: "ui-monospace, SFMono-Regular, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas, monospace",
  };

  // ─── Aliases legados ──────────────────────────────────────────────────────
  // Os componentes foram escritos contra estes nomes. Mantidos apontando para os
  // tokens novos para que a migração aconteça arquivo a arquivo sem quebrar
  // nada. Código novo usa os nomes acima; estes existem para não deixar o app em
  // dois estados visuais durante o build.
  return {
    ...t,

    cardBg: t.surface,
    cardBgWeekend: t.surfaceAlt,
    cardBorder: t.border,
    cardBorderToday: t.accent,

    headerBg: t.surface,
    headerBorder: t.border,
    // `headerGrad` foi REMOVIDO. Era um linear-gradient decorativo que os
    // cabeçalhos usavam com `text-white` nos DOIS temas — daí a dúzia de
    // rgba(255,255,255,x) hardcoded que ignoravam o tema. Nenhum cabeçalho é
    // mais um bloco colorido, então o token não tem leitor e um alias com nome
    // que mente ("Grad" apontando para uma superfície chapada) é pior que nada.

    dateColBg: t.surfaceSunken,
    dateColBgWeekend: dark ? '#12151A' : '#EDEFF2',
    dateColBorder: t.border,

    divider: t.border,
    cycleBg: t.surfaceHover,
    cycleColor: t.textSecondary,

    labelColor: t.textMuted,
    dateNumColor: t.textPrimary,
    monthShortColor: t.textMuted,

    // Controles selecionados: o estado ativo é o acento, não um inverso
    // preto-no-branco. O tema antigo pintava o filtro ativo de #F1F5F9 com texto
    // #0F172A, um inverso de alto contraste que competia com o conteúdo.
    filterAllBg: t.accentFill, filterAllColor: t.accentInk, filterAllBorder: t.accentFill,
    filterDefBg: 'transparent', filterDefColor: t.textSecondary, filterDefBorder: t.border,
    monthActiveBg: t.accentFill, monthActiveColor: t.accentInk, monthActiveBorder: t.accentFill,
    monthDefBg: 'transparent', monthDefColor: t.textSecondary, monthDefBorder: t.border,

    inputBg: t.surfaceSunken,
    inputBorder: t.borderStrong,

    saveBg: t.accentFill, saveColor: t.accentInk,
    cancelBg: 'transparent', cancelColor: t.textSecondary, cancelBorder: t.border,

    rowEditBg: t.accentQuiet,
    rowSchedBg: t.surfaceAlt,

    exportBg: t.success,
    footerText: t.textMuted,
  };
}

// getTheme é chamado em todo render; os dois modos são imutáveis, então cache.
const CACHE = { true: null, false: null };

export function getTheme(dark) {
  const k = String(Boolean(dark));
  if (!CACHE[k]) CACHE[k] = build(Boolean(dark));
  return CACHE[k];
}
