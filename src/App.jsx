import { useState, useEffect } from 'react';
import { SignedIn, SignedOut, UserButton, useUser, useClerk } from '@clerk/clerk-react';
import { useApi } from './lib/api';
import { Icon, Badge, Button } from './components/ui';
import { getTheme } from './lib/theme';
import EscalaSobreaviso from './components/EscalaSobreaviso';
import ControleDeHoras from './components/ControleDeHoras';
import EstruturaEscala from './components/EstruturaEscala';
import MeuResumoFinanceiro from './components/MeuResumoFinanceiro';

// ─── NAVEGAÇÃO ────────────────────────────────────────────────────────────────
// Abas com sublinhado de acento, não pílulas. A barra usa a superfície do tema
// nos DOIS modos: antes era um bloco #020617/#1E293B com texto branco forçado,
// então no tema claro o app abria com uma faixa quase preta em cima de uma página
// clara, e todo texto dentro dela precisava de rgba(255,255,255,x) hardcoded.

function Tab({ T, active, onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
        background: 'transparent',
        color: active ? T.textPrimary : T.textMuted,
        border: 'none',
        borderBottom: `2px solid ${active ? T.accent : 'transparent'}`,
        padding: '0 0.2rem',
        margin: '0 0.55rem',
        height: '2.75rem',
        fontSize: '0.82rem',
        fontWeight: active ? 700 : 600,
        cursor: 'pointer',
        transition: 'color 0.12s, border-color 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

function NavBar({ T, children }) {
  return (
    <nav aria-label="Seções do aplicativo" style={{
      background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      padding: '0 0.9rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.15rem',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      minHeight: '2.75rem',
    }}>
      {children}
    </nav>
  );
}

// ─── APP PRINCIPAL (só renderiza se autenticado) ──────────────────────────────

function MainApp() {
  const api = useApi();
  const { user } = useUser();
  // A aba vive no hash da URL — refresh e links compartilhados preservam a view
  const hashToView = (h) => (h === '#controle' ? 'controle' : h === '#estrutura' ? 'estrutura' : h === '#meu-resumo-financeiro' ? 'meu-resumo' : 'escala');
  const [view, setViewState] = useState(() => hashToView(window.location.hash));
  const [dark, setDark]       = useState(true);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const storageKey = user?.id ? `escala_profile_${user.id}` : null;
  const isAdmin = profile?.role === 'admin';
  const canAccessCH = isAdmin || profile?.role === 'member';

  const setView = (v) => {
    setViewState(v);
    window.history.replaceState(null, '', `#${v}`);
  };

  useEffect(() => {
    document.title = view === 'controle'
      ? 'Controle de Horas — Escala de Sobreaviso'
      : view === 'estrutura'
      ? 'Estrutura da Escala — Escala de Sobreaviso'
      : view === 'meu-resumo'
      ? 'Meu Resumo Financeiro — Escala de Sobreaviso'
      : 'Escala de Sobreaviso';
  }, [view]);

  useEffect(() => {
    if (!user?.id) return;

    // Load from localStorage immediately — avoids loading flash on warm sessions.
    // Only trust cache entries that include role (post-allowlist format).
    // Old caches without role are discarded so the API response always wins.
    let hasLocal = false;
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const p = JSON.parse(cached);
        if (p && typeof p.role === 'string') {
          setProfile(p);
          if (typeof p.dark === 'boolean') setDark(p.dark);
          setLoading(false);
          hasLocal = true;
        }
      }
    } catch {}

    // Background sync — server is source of truth for memberId and role
    api('/api/profile')
      .then(sp => {
        setProfile(sp);
        if (typeof sp.dark === 'boolean') setDark(sp.dark);
        localStorage.setItem(storageKey, JSON.stringify(sp));
      })
      .catch(err => {
        console.error('Erro ao sincronizar perfil:', err);
        if (!hasLocal) setProfile({ role: 'viewer', memberId: null, teamId: null, adminOf: [], dark: true });
      })
      .finally(() => {
        if (!hasLocal) setLoading(false);
      });
  }, [user?.id]);

  const saveProfile = async (updates) => {
    const next = { ...profile, ...updates };
    setProfile(next);
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
    // Only send mutable user preferences — role/memberId/teamId/adminOf são do backend
    const { dark: d, filter, monthKey, teamView } = updates;
    const prefs = {};
    if (typeof d === 'boolean') prefs.dark = d;
    if (filter   !== undefined) prefs.filter   = filter;
    if (monthKey !== undefined) prefs.monthKey = monthKey;
    if (teamView !== undefined) prefs.teamView = teamView;
    if (Object.keys(prefs).length > 0) {
      api('/api/profile', { method: 'POST', body: prefs }).catch(console.error);
    }
    return next;
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    saveProfile({ dark: next });
  };

  const T = getTheme(dark);

  if (loading) {
    const TL = getTheme(true);
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: TL.pageBg }}>
        <div style={{ color: TL.textMuted, fontSize: '0.85rem' }} role="status">Carregando seu perfil…</div>
      </div>
    );
  }

  return (
    <div style={{ background: T.pageBg, minHeight: '100vh' }}>
      <NavBar T={T}>
        <img src="/logo.png" alt="" width={22} height={22} style={{ borderRadius: '4px', flexShrink: 0, marginRight: '0.6rem' }} />
        <Tab T={T} active={view === 'escala'} onClick={() => setView('escala')} icon="calendar">Escala</Tab>
        {profile?.memberId && (
          <Tab T={T} active={view === 'meu-resumo'} onClick={() => setView('meu-resumo')} icon="users">Meu Resumo Financeiro</Tab>
        )}
        {canAccessCH && (
          <Tab T={T} active={view === 'controle'} onClick={() => setView('controle')} icon="clock">Controle de Horas</Tab>
        )}
        {isAdmin && (
          <Tab T={T} active={view === 'estrutura'} onClick={() => setView('estrutura')} icon="layers">Estrutura</Tab>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Button T={T} size="sm" variant="quiet" onClick={toggleDark}
            aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}>
            <Icon name={dark ? 'sun' : 'moon'} size={14} />
          </Button>
          {profile?.memberId && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', color: T.textSecondary, fontWeight: 600 }}>
              {profile.memberId}
              {isAdmin && <Badge T={T} tone="accent">admin</Badge>}
            </span>
          )}
          <UserButton afterSignOutUrl="/" />
        </div>
      </NavBar>

      {view === 'meu-resumo' && profile?.memberId ? (
        <MeuResumoFinanceiro dark={dark} profile={profile} />
      ) : view === 'estrutura' && isAdmin ? (
        <EstruturaEscala dark={dark} profile={profile} />
      ) : view === 'controle' && canAccessCH ? (
        <ControleDeHoras dark={dark} profile={profile} />
      ) : (
        <EscalaSobreaviso dark={dark} onToggleDark={toggleDark} profile={profile} saveProfile={saveProfile} />
      )}
    </div>
  );
}

// ─── VISUALIZAÇÃO PÚBLICA (não autenticado) ───────────────────────────────────
// Mostra a escala em modo somente-leitura com botão "Entrar".
// GET /api/schedule e GET /api/substitutions são públicos — sem token necessário.

function PublicApp() {
  const { openSignIn } = useClerk();
  const [dark, setDark] = useState(true);
  const T = getTheme(dark);

  return (
    <div style={{ background: T.pageBg, minHeight: '100vh' }}>
      <NavBar T={T}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', fontWeight: 700, color: T.textPrimary }}>
          <img src="/logo.png" alt="" width={22} height={22} style={{ borderRadius: '4px', flexShrink: 0 }} />
          Escala de Sobreaviso
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Button T={T} size="sm" variant="quiet" onClick={() => setDark(d => !d)}
            aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}>
            <Icon name={dark ? 'sun' : 'moon'} size={14} />
          </Button>
          <Button T={T} size="sm" variant="primary" onClick={() => openSignIn()}>Entrar</Button>
        </div>
      </NavBar>
      <EscalaSobreaviso
        dark={dark}
        onToggleDark={() => setDark(d => !d)}
        profile={{ role: 'viewer', memberId: null, teamId: null, adminOf: [] }}
        saveProfile={() => {}}
      />
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function App() {
  // Harnesses de desenvolvimento (`#custo-demo` e `#meu-resumo-demo`): renderizam
  // visões com dados injetados/sintéticos, sem Clerk/backend. Dynamic import sob
  // import.meta.env.DEV garante que jamais entram no bundle de produção.
  const [devDemo, setDevDemo] = useState(null);
  const [devMeuResumo, setDevMeuResumo] = useState(null);
  const [devErro, setDevErro] = useState(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const h = window.location.hash;
    const rotas = [
      { hash: '#custo-demo', setter: setDevDemo, mod: './DevCustoDemo' },
      { hash: '#meu-resumo-demo', setter: setDevMeuResumo, mod: './DevMeuResumoDemo' },
      { hash: '#meu-resumo-financeiro-demo', setter: setDevMeuResumo, mod: './DevMeuResumoDemo' },
    ];
    const alvo = rotas.find((r) => r.hash === h);
    if (alvo) {
      import(alvo.mod)
        .then((m) => alvo.setter(() => m.default))
        .catch((e) => {
          console.error('Falha ao carregar a demo:', e);
          setDevErro('A demo não pôde ser carregada — confira o console do navegador.');
        });
    }
  }, []);
  if (devErro) return <div role="alert" style={{ padding: '2rem', color: getTheme(true).danger }}>{devErro}</div>;
  if (devDemo) {
    const C = devDemo;
    return <C />;
  }
  if (devMeuResumo) {
    const C = devMeuResumo;
    return <C />;
  }
  if (import.meta.env.DEV && (window.location.hash === '#custo-demo'
    || window.location.hash === '#meu-resumo-demo'
    || window.location.hash === '#meu-resumo-financeiro-demo')) {
    return <div style={{ padding: '2rem', color: getTheme(true).textMuted }}>Carregando a demo…</div>;
  }

  return (
    <>
      <SignedOut>
        <PublicApp />
      </SignedOut>
      <SignedIn>
        <MainApp />
      </SignedIn>
    </>
  );
}
