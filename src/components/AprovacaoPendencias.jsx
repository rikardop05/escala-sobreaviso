import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../lib/api';
import { durationHours, fmtHM } from '../lib/schedule';
import { MEMBERS } from '../lib/teams';
import { getTheme } from '../lib/theme';
import { Icon, friendlyError } from './ui';

// Aprovação do excedente de Hora Extra (admin) — a parte de uma Hora Extra que
// caiu fora do sobreaviso da pessoa fica "pendente" até alguém que administra a
// equipe decidir (ver src/lib/chCalc.js — splitHoraExtra, e api/ch-approve.js).
//
// Checa pendências das equipes em profile.adminOf assim que a aba abre; se
// houver alguma, abre o modal automaticamente. O botão "Verificar pendências"
// reconsulta sem recarregar a página — para quem já estava com a tela aberta
// quando uma nova Hora Extra excedente foi lançada por outra pessoa.
export default function AprovacaoPendencias({ dark, profile }) {
  const api = useApi();
  const T = getTheme(dark);

  const [pendencias, setPendencias] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);

  // { [`${person}|${entryId}`]: 'aprovando' | 'rejeitando' } — por linha, pra não
  // travar as outras enquanto uma decisão está em voo.
  const [busy, setBusy] = useState({});
  // { [`${person}|${entryId}`]: string } — rascunho do motivo de rejeição, só
  // enquanto o campo estiver aberto naquela linha.
  const [motivoDraft, setMotivoDraft] = useState({});
  const [rejectingKey, setRejectingKey] = useState(null);

  const rowKey = (p) => `${p.person}|${p.entryId}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/api/ch-approve');
      setPendencias(data || []);
      return data || [];
    } catch (e) {
      setError(friendlyError(e));
      return null;
    } finally {
      setLoading(false);
      setCheckedOnce(true);
    }
  }, [api]);

  // Checagem automática ao abrir a aba — só uma vez.
  useEffect(() => {
    if (checkedOnce) return;
    load().then(data => { if (data && data.length > 0) setOpen(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verificar = async () => {
    await load();
    setOpen(true);
  };

  const decidir = async (p, acao, motivo) => {
    const key = rowKey(p);
    setBusy(b => ({ ...b, [key]: acao === 'aprovar' ? 'aprovando' : 'rejeitando' }));
    setError(null);
    try {
      await api('/api/ch-approve', { method: 'POST', body: { person: p.person, entryId: p.entryId, acao, motivo } });
      setPendencias(list => list.filter(x => rowKey(x) !== key));
      setRejectingKey(null);
      setMotivoDraft(d => { const n = { ...d }; delete n[key]; return n; });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(b => { const n = { ...b }; delete n[key]; return n; });
    }
  };

  const btnStyle = (bg, color, border) => ({
    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
    background: bg, color, border: border || '1px solid transparent',
    borderRadius: T.rControl, padding: '0.45rem 0.8rem', minHeight: '2.5rem',
    fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
  });

  // Aprovar e Rejeitar são o mesmo peso visual: os dois são decisões, e deixar
  // uma delas preenchida empurraria o admin para o caminho mais fácil.
  const approveStyle = btnStyle(T.successQuiet, T.success, `1px solid ${T.successBorder}`);
  const rejectStyle  = btnStyle(T.dangerQuiet,  T.danger,  `1px solid ${T.dangerBorder}`);

  return (
    <>
      {/* Havendo pendência o botão assume o tom de aviso; sem pendência fica
          secundário. O contador antes usava rgba(255,255,255,0.3), que só
          funcionava sobre um fundo escuro — agora vem do tom, como o resto. */}
      <button type="button" onClick={verificar} disabled={loading}
        className="inline-flex items-center gap-2"
        style={{
          background: pendencias.length > 0 ? T.warnQuiet : 'transparent',
          color: pendencias.length > 0 ? T.warn : T.textSecondary,
          border: `1px solid ${pendencias.length > 0 ? T.warnBorder : T.border}`,
          borderRadius: T.rControl, padding: '0.45rem 0.8rem', minHeight: '2.5rem',
          fontWeight: 600, fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer',
        }}>
        <Icon name="alert" size={15} />
        {loading ? 'Verificando…' : 'Verificar pendências'}
        {pendencias.length > 0 && (
          <span className="tnum inline-flex items-center justify-center"
            style={{ background: T.warn, color: T.dark ? '#1A1206' : '#FFFFFF', borderRadius: T.rPill, minWidth: '1.3rem', height: '1.3rem', fontSize: '0.7rem', fontWeight: 800, padding: '0 0.28rem' }}>
            {pendencias.length}
          </span>
        )}
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 80, background: T.dark ? 'rgba(6,7,9,0.72)' : 'rgba(16,20,28,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          {/* Overlay: sombra, sem borda — elevação declarada uma vez. */}
          <div role="dialog" aria-modal="true" aria-label="Pendências de Hora Extra excedente" onClick={e => e.stopPropagation()}
            style={{ background: T.surface, color: T.textPrimary, borderRadius: T.rPanel, padding: '1.1rem', maxWidth: '38rem', width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: T.shadowOverlay }}>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                Hora Extra excedente pendente de aprovação
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Fechar"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2.5rem', height: '2.5rem', borderRadius: '0.5rem', flexShrink: 0 }}>
                <Icon name="x" size={16} />
              </button>
            </div>

            {error && (
              <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color: T.danger }}>
                <Icon name="alert" size={13} /> {error}
              </p>
            )}

            {pendencias.length === 0 ? (
              <p className="text-sm" style={{ color: T.textMuted }}>Nenhuma pendência agora.</p>
            ) : (
              <div>
                {pendencias.map(p => {
                  const key = rowKey(p);
                  const rowBusy = busy[key];
                  const fullName = MEMBERS[p.person]?.fullName || p.person;
                  const h = durationHours(p.inicio, p.fim);
                  const isRejecting = rejectingKey === key;
                  return (
                    <div key={key} className="py-2.5" style={{ borderTop: `1px solid ${T.divider}` }}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: T.textPrimary }}>{fullName}</div>
                          <div className="font-mono" style={{ fontSize: '0.78rem', color: T.textMuted }}>
                            {p.data.slice(8, 10)}/{p.data.slice(5, 7)} · {p.inicio}–{p.fim} · {fmtHM(h)}
                          </div>
                        </div>
                        {!isRejecting && (
                          <div className="flex gap-2">
                            <button onClick={() => decidir(p, 'aprovar')} disabled={!!rowBusy}
                              style={approveStyle}>
                              <Icon name="check" size={13} /> {rowBusy === 'aprovando' ? 'Aprovando…' : 'Aprovar'}
                            </button>
                            <button onClick={() => setRejectingKey(key)} disabled={!!rowBusy}
                              style={rejectStyle}>
                              <Icon name="x" size={13} /> Rejeitar
                            </button>
                          </div>
                        )}
                      </div>
                      {isRejecting && (
                        <div className="mt-2 flex flex-wrap gap-2 items-start">
                          <input
                            autoFocus
                            value={motivoDraft[key] || ''}
                            onChange={e => setMotivoDraft(d => ({ ...d, [key]: e.target.value }))}
                            placeholder="Motivo da rejeição (obrigatório)"
                            style={{ flex: '1 1 200px', background: T.inputBg, color: T.textPrimary, border: `1px solid ${T.inputBorder}`, borderRadius: T.rControl, padding: '0.5rem 0.6rem', minHeight: '2.5rem', fontSize: '0.82rem' }}
                          />
                          {/* Confirmar a rejeição é a ação destrutiva do fluxo —
                              aqui, e só aqui, ela vem preenchida. */}
                          <button onClick={() => decidir(p, 'rejeitar', motivoDraft[key])}
                            disabled={!!rowBusy || !(motivoDraft[key] || '').trim()}
                            style={btnStyle(T.danger, T.dark ? '#1A0E0F' : '#FFFFFF')}>
                            {rowBusy === 'rejeitando' ? 'Rejeitando…' : 'Confirmar rejeição'}
                          </button>
                          <button onClick={() => setRejectingKey(null)} disabled={!!rowBusy}
                            style={btnStyle('transparent', T.textSecondary, `1px solid ${T.border}`)}>
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
