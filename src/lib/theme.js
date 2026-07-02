// Tema unificado — usado por EscalaSobreaviso e ControleDeHoras.
// Um único dicionário por modo evita o drift que existia entre os temas locais (T/CT).
// Todos os pares texto/fundo cumprem WCAG AA (≥4.5:1 para texto pequeno).

export const ACCENT = '#6366F1';
export const DANGER = '#EF4444';
export const WARN   = '#F59E0B';

export function getTheme(dark) {
  return dark ? {
    dark: true,
    pageBg: '#0F172A', cardBg: '#1E293B', cardBgWeekend: '#1A2336',
    cardBorder: '#334155', cardBorderToday: '#94A3B8',
    headerGrad: 'linear-gradient(135deg,#020617 0%,#0F172A 100%)',
    dateColBg: '#162032', dateColBgWeekend: '#1C2840', dateColBorder: '#334155',
    divider: '#263347',
    cycleBg: '#334155', cycleColor: '#CBD5E1',
    // #F1F5F9 ≈ 15:1 · #CBD5E1 ≈ 9:1 · #94A3B8 ≈ 5.9:1 sobre cardBg
    textPrimary: '#F1F5F9', textSecondary: '#CBD5E1', textMuted: '#94A3B8',
    labelColor: '#94A3B8',
    dateNumColor: '#CBD5E1', monthShortColor: '#94A3B8',
    filterAllBg: '#F1F5F9', filterAllColor: '#0F172A', filterAllBorder: '#F1F5F9',
    filterDefBg: '#1E293B', filterDefColor: '#94A3B8', filterDefBorder: '#334155',
    monthActiveBg: '#F1F5F9', monthActiveColor: '#0F172A', monthActiveBorder: '#F1F5F9',
    monthDefBg: '#1E293B', monthDefColor: '#94A3B8', monthDefBorder: '#334155',
    inputBg: '#0F172A', inputBorder: '#334155',
    saveBg: '#F1F5F9', saveColor: '#0F172A',
    cancelBg: '#1E293B', cancelColor: '#94A3B8', cancelBorder: '#334155',
    rowEditBg: '#162032', rowSchedBg: '#0F1E36',
    exportBg: '#166534',
    footerText: '#94A3B8',
    skeletonBg: '#1E293B',
  } : {
    dark: false,
    pageBg: '#EEF1F6', cardBg: '#fff', cardBgWeekend: '#FDFBEF',
    cardBorder: '#E2E8F0', cardBorderToday: '#1E293B',
    headerGrad: 'linear-gradient(135deg,#1E293B 0%,#334155 100%)',
    dateColBg: '#F1F5F9', dateColBgWeekend: '#F5EFD0', dateColBorder: '#E2E8F0',
    divider: '#F1F5F9',
    cycleBg: '#E2E8F0', cycleColor: '#334155',
    // #1E293B ≈ 14:1 · #334155 ≈ 10:1 · #475569 ≈ 7.4:1 sobre branco
    textPrimary: '#1E293B', textSecondary: '#334155', textMuted: '#475569',
    labelColor: '#475569',
    dateNumColor: '#1E293B', monthShortColor: '#475569',
    filterAllBg: '#1E293B', filterAllColor: '#fff', filterAllBorder: '#1E293B',
    filterDefBg: '#fff', filterDefColor: '#475569', filterDefBorder: '#CBD5E1',
    monthActiveBg: '#1E293B', monthActiveColor: '#fff', monthActiveBorder: '#1E293B',
    monthDefBg: '#fff', monthDefColor: '#475569', monthDefBorder: '#E2E8F0',
    inputBg: '#fff', inputBorder: '#CBD5E1',
    saveBg: '#1E293B', saveColor: '#fff',
    cancelBg: '#fff', cancelColor: '#475569', cancelBorder: '#CBD5E1',
    rowEditBg: '#F8FAFC', rowSchedBg: '#EFF6FF',
    exportBg: '#2E7D32',
    footerText: '#475569',
    skeletonBg: '#E2E8F0',
  };
}
