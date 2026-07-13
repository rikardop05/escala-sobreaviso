import { useState, useEffect } from 'react';
import { SignedIn, SignedOut, UserButton, useUser, useClerk } from '@clerk/clerk-react';
import { useApi } from './lib/api';
import { Icon } from './components/ui';
import EscalaSobreaviso from './components/EscalaSobreaviso';
import ControleDeHoras from './components/ControleDeHoras';
import EstruturaEscala from './components/EstruturaEscala';

// ─── APP PRINCIPAL (só renderiza se autenticado) ──────────────────────────────

function MainApp() {
  const api = useApi();
  const { user } = useUser();
  // A aba vive no hash da URL — refresh e links compartilhados preservam a view
  const hashToView = (h) => (h === '#controle' ? 'controle' : h === '#estrutura' ? 'estrutura' : 'escala');
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
        if (!hasLocal) setProfile({ role: 'viewer', memberId: null, dark: true });
      })
      .finally(() => {
        if (!hasLocal) setLoading(false);
      });
  }, [user?.id]);

  const saveProfile = async (updates) => {
    const next = { ...profile, ...updates };
    setProfile(next);
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
    // Only send mutable user preferences — role/memberId are backend-controlled
    const { dark: d, filter, monthKey } = updates;
    const prefs = {};
    if (typeof d === 'boolean') prefs.dark = d;
    if (filter   !== undefined) prefs.filter   = filter;
    if (monthKey !== undefined) prefs.monthKey = monthKey;
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0F172A" }}>
        <div className="text-slate-400 text-sm" role="status">Carregando seu perfil…</div>
      </div>
    );
  }

  const navBg = dark ? "#020617" : "#1E293B";

  const tabStyle = (active) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    background: active ? "rgba(255,255,255,0.15)" : "transparent",
    color: active ? "#fff" : "rgba(255,255,255,0.7)",
    border: "1px solid " + (active ? "rgba(255,255,255,0.25)" : "transparent"),
    borderRadius: "9999px",
    padding: "0.55rem 1rem",
    minHeight: "2.75rem",
    fontSize: "0.8rem",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.15s",
    letterSpacing: "0.02em",
  });

  return (
    <div>
      <nav aria-label="Seções do aplicativo" style={{
        background: navBg,
        padding: "0.35rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        transition: "background 0.2s",
      }}>
        <button onClick={() => setView('escala')} style={tabStyle(view === 'escala')} aria-current={view === 'escala' ? 'page' : undefined}>
          <Icon name="calendar" size={15} /> Escala
        </button>
        {canAccessCH && (
          <button onClick={() => setView('controle')} style={tabStyle(view === 'controle')} aria-current={view === 'controle' ? 'page' : undefined}>
            <Icon name="clock" size={15} /> Controle de Horas
          </button>
        )}
        {isAdmin && (
          <button onClick={() => setView('estrutura')} style={tabStyle(view === 'estrutura')} aria-current={view === 'estrutura' ? 'page' : undefined}>
            <Icon name="calendar" size={15} /> Estrutura
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {profile?.memberId && (
            <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", fontWeight: "600" }}>
              {profile.memberId}
              {profile.role === 'admin' && (
                <span style={{ marginLeft: "0.3rem", fontSize: "0.6rem", background: "rgba(250,204,21,0.15)", color: "#FCD34D", borderRadius: "3px", padding: "1px 4px", verticalAlign: "middle" }}>
                  admin
                </span>
              )}
            </span>
          )}
          <UserButton afterSignOutUrl="/" />
        </div>
      </nav>

      {view === 'estrutura' && isAdmin ? (
        <EstruturaEscala dark={dark} />
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

  const navBg = dark ? "#020617" : "#1E293B";

  return (
    <div>
      <header style={{
        background: navBg,
        padding: "0.35rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        transition: "background 0.2s",
        minHeight: "3.25rem",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", fontSize: "0.85rem", fontWeight: "700", color: "#fff" }}>
          <Icon name="calendar" size={15} /> Escala de Sobreaviso
        </span>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={() => openSignIn()} style={{
            background: "rgba(255,255,255,0.15)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: "9999px",
            padding: "0.55rem 1.1rem",
            minHeight: "2.75rem",
            fontSize: "0.8rem",
            fontWeight: "700",
            cursor: "pointer",
            letterSpacing: "0.02em",
          }}>
            Entrar
          </button>
        </div>
      </header>
      <EscalaSobreaviso
        dark={dark}
        onToggleDark={() => setDark(d => !d)}
        profile={{ role: 'viewer', memberId: null }}
        saveProfile={() => {}}
      />
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function App() {
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
