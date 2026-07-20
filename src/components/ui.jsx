// Kit de UI compartilhado: ícones SVG, status de salvamento, snackbar de undo,
// diálogo de confirmação e mapeamento de erros para mensagens amigáveis.
import { useEffect } from 'react';
import { ACCENT, DANGER } from '../lib/theme';

// ─── ÍCONES (traço, herdam currentColor) ─────────────────────────────────────

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
    saving: { color: T.textMuted,  label: 'Salvando…' },
    saved:  { color: '#22C55E',    label: 'Salvo' },
    error:  { color: DANGER,       label: 'Erro ao salvar' },
  }[status];
  return (
    <span role="status" aria-live="polite"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 600, color: styles.color }}>
      {status === 'saved' && <Icon name="check" size={14} />}
      {status === 'error' && <Icon name="alert" size={14} />}
      {styles.label}
      {status === 'error' && onRetry && (
        <button onClick={onRetry}
          style={{ background: 'none', border: `1px solid ${DANGER}`, color: DANGER, borderRadius: '9999px', padding: '0.15rem 0.6rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', minHeight: '1.75rem' }}>
          Tentar de novo
        </button>
      )}
    </span>
  );
}

// ─── SNACKBAR (undo) ─────────────────────────────────────────────────────────

export function Snackbar({ open, message, actionLabel, onAction, T }) {
  if (!open) return null;
  return (
    <div role="status" aria-live="polite"
      style={{
        position: 'fixed', bottom: '1.25rem', left: '50%', transform: 'translateX(-50%)',
        zIndex: 60, display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: T.dark ? '#F1F5F9' : '#1E293B', color: T.dark ? '#0F172A' : '#F1F5F9',
        borderRadius: '0.75rem', padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 600,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)', maxWidth: 'calc(100vw - 2rem)',
      }}>
      <span>{message}</span>
      {actionLabel && (
        <button onClick={onAction}
          style={{ background: 'none', border: 'none', color: ACCENT, fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', padding: '0.5rem 0.25rem', minHeight: '2.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
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
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(2,6,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div role="alertdialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        style={{ background: T.cardBg, color: T.textPrimary, border: `1px solid ${T.cardBorder}`, borderRadius: '1rem', padding: '1.25rem', maxWidth: '26rem', width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.45)' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>{title}</h2>
        <p style={{ fontSize: '0.85rem', color: T.textSecondary, margin: '0 0 1rem 0', lineHeight: 1.5 }}>{body}</p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={onCancel} autoFocus
            style={{ background: T.cancelBg, color: T.cancelColor, border: `1px solid ${T.cancelBorder}`, borderRadius: '0.5rem', padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', minHeight: '2.75rem' }}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm}
            style={{ background: DANGER, color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', minHeight: '2.75rem' }}>
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
      style={{ width: w, height: h, borderRadius: '0.5rem', background: T.skeletonBg, ...style }} />
  );
}
