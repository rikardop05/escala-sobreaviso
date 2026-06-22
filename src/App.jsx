import { useState, useEffect } from 'react';
import { SignedIn, SignedOut, RedirectToSignIn, UserButton } from '@clerk/clerk-react';
import { useApi } from './lib/api';
import { PEOPLE } from './lib/schedule';
import EscalaSobreaviso from './components/EscalaSobreaviso';
import ControleDeHoras from './components/ControleDeHoras';

// ─── TELA DE SELEÇÃO DE MEMBRO ───────────────────────────────────────────────

function ProfileSetup({ onSelect }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#0F172A" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-white text-2xl font-bold mb-1">Bem-vindo!</div>
          <div className="text-slate-400 text-sm">Qual membro da equipe você é?</div>
        </div>
        <div className="space-y-2">
          {Object.entries(PEOPLE).map(([name, p]) => (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-left transition-all hover:scale-[1.02]"
              style={{ background: p.bg, color: p.color, border: `2px solid ${p.color}22` }}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: p.color }} />
              {name}
            </button>
          ))}
          <button
            onClick={() => onSelect(null)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-left transition-all hover:scale-[1.02] text-slate-400"
            style={{ background: "#1E293B", border: "2px solid #33415533" }}
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0 bg-slate-500" />
            Só visualizar (sem vínculo)
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL (só renderiza se autenticado) ──────────────────────────────

function MainApp() {
  const api = useApi();
  const [view, setView]         = useState('escala');
  const [dark, setDark]         = useState(true);
  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api('/api/profile')
      .then(p => {
        setProfile(p || {});
        if (typeof p?.dark === 'boolean') setDark(p.dark);
      })
      .catch(() => setProfile({}))
      .finally(() => setLoading(false));
  }, []);

  const saveProfile = async (updates) => {
    const next = { ...profile, ...updates };
    setProfile(next);
    api('/api/profile', { method: 'POST', body: next }).catch(console.error);
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

  if (profile && profile.memberId === undefined) {
    return (
      <ProfileSetup onSelect={(memberId) => saveProfile({ memberId, dark: true })} />
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
        <button onClick={() => setView('controle')} style={tabStyle(view === 'controle')}>
          ⏱ Controle de Horas
        </button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {profile?.memberId && (
            <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.45)", fontWeight: "600" }}>
              {profile.memberId}
            </span>
          )}
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>

      {view === 'escala'
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
