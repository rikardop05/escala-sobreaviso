import { useState, useEffect } from 'react';
import { SignedIn, SignedOut, RedirectToSignIn, UserButton, useUser } from '@clerk/clerk-react';
import { useApi } from './lib/api';
import EscalaSobreaviso from './components/EscalaSobreaviso';
import ControleDeHoras from './components/ControleDeHoras';

// ─── APP PRINCIPAL (só renderiza se autenticado) ──────────────────────────────

function MainApp() {
  const api = useApi();
  const { user } = useUser();
  const [view, setView]       = useState('escala');
  const [dark, setDark]       = useState(true);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const storageKey = user?.id ? `escala_profile_${user.id}` : null;
  const canAccessCH = profile?.role === 'admin' || profile?.role === 'member';

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
        <div className="text-slate-400 text-sm">Carregando...</div>
      </div>
    );
  }

  const navBg = dark ? "#020617" : "#1E293B";

  const tabStyle = (active) => ({
    background: active ? "rgba(255,255,255,0.15)" : "transparent",
    color: active ? "#fff" : "rgba(255,255,255,0.45)",
    border: "1px solid " + (active ? "rgba(255,255,255,0.25)" : "transparent"),
    borderRadius: "9999px",
    padding: "0.3rem 1rem",
    fontSize: "0.8rem",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.15s",
    letterSpacing: "0.02em",
  });

  return (
    <div>
      <div style={{
        background: navBg,
        padding: "0.5rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        transition: "background 0.2s",
      }}>
        <button onClick={() => setView('escala')} style={tabStyle(view === 'escala')}>
          📅 Escala
        </button>
        {canAccessCH && (
          <button onClick={() => setView('controle')} style={tabStyle(view === 'controle')}>
            ⏱ Controle de Horas
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {profile?.memberId && (
            <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.45)", fontWeight: "600" }}>
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
      </div>

      {view === 'escala' || !canAccessCH
        ? <EscalaSobreaviso dark={dark} onToggleDark={toggleDark} profile={profile} saveProfile={saveProfile} />
        : <ControleDeHoras dark={dark} profile={profile} />}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <MainApp />
      </SignedIn>
    </>
  );
}
