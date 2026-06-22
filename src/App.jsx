import { useState, useEffect } from 'react';
import { SignedIn, SignedOut, RedirectToSignIn, UserButton, useUser } from '@clerk/clerk-react';
import { useApi } from './lib/api';
import { PEOPLE, CH_NAMES } from './lib/schedule';
import EscalaSobreaviso from './components/EscalaSobreaviso';
import ControleDeHoras from './components/ControleDeHoras';

// ─── TELA DE SELEÇÃO DE MEMBRO ───────────────────────────────────────────────

function ProfileSetup({ onSelect }) {
  const [pending, setPending] = useState(null);

  const handleSelect = (name) => {
    setPending(name);
  };

  const handleConfirm = () => {
    onSelect(pending);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#0F172A" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-white text-2xl font-bold mb-1">Bem-vindo!</div>
          <div className="text-slate-400 text-sm">Qual membro da equipe você é?</div>
        </div>

        <div className="space-y-2">
          {Object.entries(PEOPLE).map(([name, p]) => {
            const isSelected = pending === name;
            return (
              <button
                key={name}
                onClick={() => handleSelect(name)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-left transition-all hover:scale-[1.02]"
                style={{
                  background: isSelected ? p.color : p.bg,
                  color: isSelected ? '#fff' : p.color,
                  border: `2px solid ${isSelected ? p.color : p.color + '22'}`,
                  transform: isSelected ? 'scale(1.02)' : undefined,
                }}
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: isSelected ? '#fff' : p.color, opacity: isSelected ? 0.8 : 1 }} />
                {name}
                {isSelected && <span className="ml-auto text-xs font-semibold opacity-80">selecionado</span>}
              </button>
            );
          })}
          <button
            onClick={() => handleSelect(null)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-left transition-all hover:scale-[1.02]"
            style={{
              background: pending === null && pending !== undefined ? "#334155" : "#1E293B",
              color: "#94A3B8",
              border: `2px solid ${pending === null && pending !== undefined ? '#64748B' : '#33415533'}`,
            }}
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0 bg-slate-500" />
            Só visualizar (sem vínculo)
          </button>
        </div>

        {/* Confirmação */}
        {pending !== undefined && pending !== null && (
          <div className="mt-6 rounded-xl p-4" style={{ background: "#1E293B", border: "1px solid #334155" }}>
            <div className="text-slate-300 text-sm mb-1">
              <span className="font-bold" style={{ color: PEOPLE[pending]?.color }}>{pending}</span> ficará permanentemente vinculado à sua conta.
            </div>
            <div className="text-slate-500 text-xs mb-4">
              Essa escolha não poderá ser alterada pelo app. Confirme apenas se você é <strong style={{ color: "#94A3B8" }}>{pending}</strong>.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPending(undefined)}
                className="flex-1 py-2 rounded-lg text-sm font-bold"
                style={{ background: "#0F172A", color: "#64748B", border: "1px solid #334155" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-2 rounded-lg text-sm font-bold text-white"
                style={{ background: PEOPLE[pending]?.color }}
              >
                Confirmar como {pending}
              </button>
            </div>
          </div>
        )}

        {pending === null && (
          <div className="mt-6 rounded-xl p-4" style={{ background: "#1E293B", border: "1px solid #334155" }}>
            <div className="text-slate-300 text-sm mb-4">
              Você entrará apenas como <span className="font-bold text-slate-200">visitante</span>, sem acesso ao Controle de Horas.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPending(undefined)}
                className="flex-1 py-2 rounded-lg text-sm font-bold"
                style={{ background: "#0F172A", color: "#64748B", border: "1px solid #334155" }}
              >
                Voltar
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-2 rounded-lg text-sm font-bold"
                style={{ background: "#334155", color: "#CBD5E1" }}
              >
                Entrar como visitante
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL (só renderiza se autenticado) ──────────────────────────────

function MainApp() {
  const api = useApi();
  const { user } = useUser();
  const [view, setView]         = useState('escala');
  const [dark, setDark]         = useState(true);
  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);

  const storageKey = user?.id ? `escala_profile_${user.id}` : null;
  const canAccessCH = profile && CH_NAMES.includes(profile.memberId);

  useEffect(() => {
    if (!user?.id) return;

    // Carrega do localStorage imediatamente (sem esperar a API)
    let hasLocal = false;
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const p = JSON.parse(cached);
        setProfile(p);
        if (typeof p?.dark === 'boolean') setDark(p.dark);
        setLoading(false);
        hasLocal = true;
      }
    } catch {}

    // Sincroniza com o servidor em background
    api('/api/profile')
      .then(p => {
        const sp = p || {};
        if (sp.memberId !== undefined) {
          // Servidor tem perfil válido — é a fonte de verdade
          setProfile(sp);
          if (typeof sp.dark === 'boolean') setDark(sp.dark);
          localStorage.setItem(storageKey, JSON.stringify(sp));
        } else if (!hasLocal) {
          // Sem cache local e servidor retornou vazio → mostra ProfileSetup
          setProfile(sp);
          localStorage.removeItem(storageKey);
        }
        // Se servidor retornou vazio mas há cache local, mantém o cache
      })
      .catch((err) => {
        console.error('Erro ao sincronizar perfil:', err);
        if (!hasLocal) setProfile({});
      })
      .finally(() => {
        if (!hasLocal) setLoading(false);
      });
  }, [user?.id]);

  const saveProfile = async (updates) => {
    const next = { ...profile, ...updates };
    setProfile(next);
    // Salva no localStorage imediatamente
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
    // Sincroniza com servidor
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
        {canAccessCH && (
          <button onClick={() => setView('controle')} style={tabStyle(view === 'controle')}>
            ⏱ Controle de Horas
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {profile?.memberId && (
            <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.45)", fontWeight: "600" }}>
              {profile.memberId}
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
