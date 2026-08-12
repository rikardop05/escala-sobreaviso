// Kit de UI compartilhado: ícones SVG, status de salvamento, snackbar de undo,
// diálogo de confirmação e mapeamento de erros para mensagens amigáveis.
//
// Elevação segue a regra do sistema (src/lib/theme.js): painel tem borda e
// nenhuma sombra; overlay tem sombra e nenhuma borda. O ConfirmDialog antes
// carregava borda de 1px E sombra larga ao mesmo tempo — o "ghost card".
import { useEffect } from 'react';
import { getTheme } from '../lib/theme';

// ─── ÍCONES (traço 2px, cap redondo, herdam currentColor) ────────────────────
// Um só peso e um só cap em todo o conjunto: ícone misturando pesos é o que faz
// uma barra de ferramentas parecer montada de duas bibliotecas.

const PATHS = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  pencil: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  alert: <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />,
  undo: <path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  umbrella: <path d="M12 2a10 10 0 0 1 10 10H2A10 10 0 0 1 12 2zM12 12v7a2 2 0 0 0 4 0" />,
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.4 20.4 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a20.4 20.4 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </>
  ),
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  layers: <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
};

export function Icon({ name, size = 16, strokeWidth = 2, style, className }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={style} className={className}
    >
      {PATHS[name] || null}
    </svg>
  );
}

// ─── ERROS AMIGÁVEIS ─────────────────────────────────────────────────────────
// Cada mensagem nomeia o problema E a recuperação — nunca só "erro".

export function friendlyError(raw) {
  let msg = String(raw?.message ?? raw ?? '');
  try { msg = JSON.parse(msg)?.error || msg; } catch { /* texto puro */ }
  if (/unauthorized|401/i.test(msg)) return 'Sua sessão expirou. Recarregue a página e entre novamente.';
  if (/forbidden|403/i.test(msg))    return 'Você não tem permissão para essa ação.';
  if (/bad request|400/i.test(msg))  return 'Não foi possível salvar. Confira os campos e tente de novo.';
  if (/failed to fetch|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
  return 'Não foi possível concluir. Tente novamente.';
}

// ─── STATUS DE SALVAMENTO ────────────────────────────────────────────────────
// status: 'idle' | 'saving' | 'saved' | 'error'

export function SaveStatus({ status, onRetry, T }) {
  if (status === 'idle') return null;
  const styles = {
    saving: { color: T.textMuted, label: 'Salvando…' },
    saved:  { color: T.success,   label: 'Salvo' },
    error:  { color: T.danger,    label: 'Erro ao salvar' },
  }[status];
  return (
    <span role="status" aria-live="polite"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 600, color: styles.color }}>
      {status === 'saved' && <Icon name="check" size={14} />}
      {status === 'error' && <Icon name="alert" size={14} />}
      {styles.label}
      {status === 'error' && onRetry && (
        <button onClick={onRetry}
          style={{ background: T.dangerQuiet, border: `1px solid ${T.dangerBorder}`, color: T.danger, borderRadius: T.rControl, padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', minHeight: '1.9rem' }}>
          Tentar de novo
        </button>
      )}
    </span>
  );
}

// ─── SNACKBAR (undo) ─────────────────────────────────────────────────────────
// Era um toast invertido (claro no tema escuro). Um inverso de alto contraste
// flutuando sobre a tela compete com o conteúdo; aqui é uma superfície do
// próprio tema, elevada por sombra.

export function Snackbar({ open, message, actionLabel, onAction, T }) {
  if (!open) return null;
  return (
    <div role="status" aria-live="polite"
      style={{
        position: 'fixed', bottom: '1.25rem', left: '50%', transform: 'translateX(-50%)',
        zIndex: 60, display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: T.surface, color: T.textPrimary,
        borderRadius: T.rPanel, padding: '0.7rem 0.75rem 0.7rem 1rem',
        fontSize: '0.85rem', fontWeight: 600,
        boxShadow: T.shadowOverlay, maxWidth: 'calc(100vw - 2rem)',
      }}>
      <span>{message}</span>
      {actionLabel && (
        <button onClick={onAction}
          style={{ background: T.accentQuiet, border: `1px solid ${T.accentBorder}`, color: T.accent, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', padding: '0.4rem 0.7rem', minHeight: '2.25rem', borderRadius: T.rControl, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
          <Icon name="undo" size={14} /> {actionLabel}
        </button>
      )}
    </div>
  );
}

// ─── DIÁLOGO DE CONFIRMAÇÃO ──────────────────────────────────────────────────

export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = 'Cancelar', onConfirm, onCancel, T }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: T.dark ? 'rgba(6,7,9,0.72)' : 'rgba(16,20,28,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div role="alertdialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        style={{ background: T.surface, color: T.textPrimary, borderRadius: T.rPanel, padding: '1.25rem', maxWidth: '26rem', width: '100%', boxShadow: T.shadowOverlay }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem 0', letterSpacing: '-0.01em' }}>{title}</h2>
        <p style={{ fontSize: '0.85rem', color: T.textSecondary, margin: '0 0 1.25rem 0', lineHeight: 1.55 }}>{body}</p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={onCancel} autoFocus
            style={{ background: 'transparent', color: T.textSecondary, border: `1px solid ${T.border}`, borderRadius: T.rControl, padding: '0.5rem 1rem', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', minHeight: '2.5rem' }}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm}
            style={{ background: T.danger, color: T.dark ? '#1A0E0F' : '#FFFFFF', border: 'none', borderRadius: T.rControl, padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', minHeight: '2.5rem' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SKELETON ────────────────────────────────────────────────────────────────

export function Skeleton({ w = '100%', h = '1rem', T, style }) {
  return (
    <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none"
      style={{ width: w, height: h, borderRadius: (T && T.rControl) || '5px', background: T.skeletonBg, ...style }} />
  );
}

// ─── PRIMITIVAS DE CONTROLE ──────────────────────────────────────────────────
// Extraídas porque o app repetia o mesmo botão inline em ~40 lugares, cada um
// com raio, padding e peso ligeiramente diferentes. Um controle, três variantes.

/**
 * variant: 'primary' | 'secondary' | 'quiet' | 'danger'
 * size: 'sm' | 'md'
 */
export function Button({ variant = 'secondary', size = 'md', dark, T: Tin, children, style, ...rest }) {
  const T = Tin || getTheme(dark);
  const pad = size === 'sm' ? '0.3rem 0.6rem' : '0.5rem 0.9rem';
  const minH = size === 'sm' ? '2rem' : '2.5rem';
  const font = size === 'sm' ? '0.72rem' : '0.8rem';
  const skin = {
    primary:   { background: T.accentFill, color: T.accentInk, border: `1px solid ${T.accentFill}` },
    secondary: { background: 'transparent', color: T.textSecondary, border: `1px solid ${T.border}` },
    quiet:     { background: 'transparent', color: T.textMuted, border: '1px solid transparent' },
    danger:    { background: T.dangerQuiet, color: T.danger, border: `1px solid ${T.dangerBorder}` },
  }[variant];
  return (
    <button
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
        borderRadius: T.rControl, padding: pad, minHeight: minH,
        fontSize: font, fontWeight: 600, cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.5 : 1,
        whiteSpace: 'nowrap', transition: 'background 0.12s, border-color 0.12s, color 0.12s',
        ...skin, ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Badge de estado. tone: 'accent' | 'success' | 'warn' | 'danger' | 'info' | 'neutral' */
export function Badge({ tone = 'neutral', T, children, icon, style }) {
  const map = {
    accent:  { fg: T.accent,  bg: T.accentQuiet },
    success: { fg: T.success, bg: T.successQuiet },
    warn:    { fg: T.warn,    bg: T.warnQuiet },
    danger:  { fg: T.danger,  bg: T.dangerQuiet },
    info:    { fg: T.info,    bg: T.infoQuiet },
    neutral: { fg: T.textMuted, bg: T.surfaceHover },
  }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
      fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.01em',
      color: map.fg, background: map.bg,
      borderRadius: T.rChip, padding: '0.1rem 0.35rem', whiteSpace: 'nowrap',
      ...style,
    }}>
      {icon && <Icon name={icon} size={10} />}
      {children}
    </span>
  );
}

/**
 * Controle segmentado — substitui as fileiras de pílulas (equipe, mês, filtro).
 * Uma faixa com hairline externo e divisores internos: o padrão de barra de
 * ferramentas de console. Pílula em todo controle era o que dava ao app o ar de
 * página de marketing.
 */
export function Segmented({ T, children, style, ...rest }) {
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'stretch',
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: T.rControl, overflow: 'hidden', ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SegmentedItem({ T, active, children, first, style, ...rest }) {
  return (
    <button
      aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        background: active ? T.accentFill : 'transparent',
        color: active ? T.accentInk : T.textSecondary,
        border: 'none',
        borderLeft: first ? 'none' : `1px solid ${T.border}`,
        padding: '0.45rem 0.8rem', minHeight: '2.25rem',
        fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
        transition: 'background 0.12s, color 0.12s',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Painel: borda, sem sombra. A regra de elevação do sistema, num componente. */
export function Panel({ T, children, style, as: As = 'section', ...rest }) {
  return (
    <As
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: T.rPanel, ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Rótulo de seção: caixa alta discreta, sem eyebrow decorativo acima de título. */
export function SectionLabel({ T, children, style }) {
  return (
    <div style={{
      fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: T.textMuted, ...style,
    }}>
      {children}
    </div>
  );
}
