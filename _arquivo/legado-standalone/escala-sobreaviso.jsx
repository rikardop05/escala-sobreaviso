import React, { useState, useMemo, useEffect } from "react";

// ─────────────────────────────────────────────────────────────
// DADOS DA ESCALA
// ─────────────────────────────────────────────────────────────

const PEOPLE = {
  Emanoel: { color: "#7B1FA2", bg: "#F3E5F5" },
  "Marcus Túlio": { color: "#2E7D32", bg: "#E8F5E9" },
  Ricardo: { color: "#1565C0", bg: "#E3F2FD" },
  Carlos: { color: "#37474F", bg: "#ECEFF1" },
  Raul: { color: "#E65100", bg: "#FFF3E0" },
  Alice: { color: "#AD1457", bg: "#FCE4EC" },
};

// Escala fixa de segunda a sexta (getDay(): 1=Seg ... 5=Sex)
const WEEKDAY_SHIFTS = {
  1: [
    { period: "Madrugada", time: "23:00 – 04:00", dur: "5h", person: "Raul" },
    { period: "Manhã", time: "04:00 – 09:00", dur: "5h", person: "Emanoel" },
    { period: "Noite", time: "18:00 – 23:00", dur: "5h", person: "Marcus Túlio" },
  ],
  2: [
    { period: "Madrugada", time: "23:00 – 04:00", dur: "5h", person: "Ricardo" },
    { period: "Manhã", time: "04:00 – 09:00", dur: "5h", person: "Carlos" },
    { period: "Noite", time: "18:00 – 23:00", dur: "5h", person: "Raul" },
  ],
  3: [
    { period: "Madrugada", time: "23:00 – 04:00", dur: "5h", person: "Marcus Túlio" },
    { period: "Manhã", time: "04:00 – 09:00", dur: "5h", person: "Emanoel" },
    { period: "Noite", time: "18:00 – 23:00", dur: "5h", person: "Raul" },
  ],
  4: [
    { period: "Madrugada", time: "23:00 – 04:00", dur: "5h", person: "Ricardo" },
    { period: "Manhã", time: "04:00 – 09:00", dur: "5h", person: "Marcus Túlio" },
    { period: "Noite", time: "18:00 – 23:00", dur: "5h", person: "Carlos" },
  ],
  5: [
    { period: "Madrugada", time: "23:00 – 04:00", dur: "5h", person: "Emanoel" },
    { period: "Manhã", time: "04:00 – 09:00", dur: "5h", person: "Raul" },
    { period: "Noite", time: "18:00 – 24:00", dur: "6h", person: "Ricardo" },
  ],
};

// Ciclo de 5 semanas do fim de semana.
// Semana 1 começa no sábado 13/06/2026.
const WEEKEND_CYCLE = [
  { sabDia: "Carlos", sabNoite: "Emanoel", domDia: "Ricardo", domNoite: "Raul", folga: "Marcus Túlio" },
  { sabDia: "Marcus Túlio", sabNoite: "Carlos", domDia: "Emanoel", domNoite: "Ricardo", folga: "Raul" },
  { sabDia: "Raul", sabNoite: "Marcus Túlio", domDia: "Carlos", domNoite: "Emanoel", folga: "Ricardo" },
  { sabDia: "Ricardo", sabNoite: "Raul", domDia: "Marcus Túlio", domNoite: "Carlos", folga: "Emanoel" },
  { sabDia: "Emanoel", sabNoite: "Ricardo", domDia: "Raul", domNoite: "Marcus Túlio", folga: "Carlos" },
];

const ANCHOR = new Date(2026, 5, 13); // Sábado 13/06/2026 = Semana 1
const RANGE_START = new Date(2026, 5, 8); // Segunda da semana atual
const RANGE_END = new Date(2027, 5, 30); // ~12 meses à frente

const DOW = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DOW_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// ─────────────────────────────────────────────────────────────
// LÓGICA
// ─────────────────────────────────────────────────────────────

const MS_DAY = 86400000;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Índice (0-4) do ciclo para a semana de um sábado
function cycleIndex(saturday) {
  const diff = Math.round((saturday.getTime() - ANCHOR.getTime()) / (7 * MS_DAY));
  return ((diff % 5) + 5) % 5;
}

// Gera todos os dias com seus turnos
function buildSchedule() {
  const days = [];
  for (let t = RANGE_START.getTime(); t <= RANGE_END.getTime(); t += MS_DAY) {
    const d = new Date(t);
    d.setHours(12, 0, 0, 0); // evita problemas de DST
    const dow = d.getDay();
    let shifts = [];
    let folga = null;
    let cycleWeek = null;

    if (dow >= 1 && dow <= 5) {
      shifts = WEEKDAY_SHIFTS[dow].map((s) => ({ ...s }));
    } else {
      const sat = dow === 6 ? d : new Date(d.getTime() - MS_DAY);
      const idx = cycleIndex(sat);
      const rot = WEEKEND_CYCLE[idx];
      cycleWeek = idx + 1;
      folga = rot.folga;
      if (dow === 6) {
        shifts = [
          { period: "Dia", time: "00:00 – 12:00", dur: "12h", person: rot.sabDia },
          { period: "Noite", time: "12:00 – 00:00", dur: "12h", person: rot.sabNoite },
        ];
      } else {
        shifts = [
          { period: "Dia", time: "00:00 – 12:00", dur: "12h", person: rot.domDia },
          { period: "Noite", time: "12:00 – 00:00", dur: "12h", person: rot.domNoite },
        ];
      }
    }
    days.push({ date: new Date(d), dow, shifts, folga, cycleWeek });
  }
  return days;
}

// Quem está de sobreaviso neste exato momento
function currentOnCall(now) {
  const dow = now.getDay();
  const h = now.getHours() + now.getMinutes() / 60;

  const weekendOf = (d) => {
    const sat = d.getDay() === 6 ? d : new Date(d.getTime() - MS_DAY);
    return WEEKEND_CYCLE[cycleIndex(sat)];
  };

  if (dow === 6) {
    const rot = weekendOf(now);
    return h < 12
      ? { person: rot.sabDia, label: "Sábado · Dia", time: "00:00 – 12:00" }
      : { person: rot.sabNoite, label: "Sábado · Noite", time: "12:00 – 00:00" };
  }
  if (dow === 0) {
    const rot = weekendOf(now);
    return h < 12
      ? { person: rot.domDia, label: "Domingo · Dia", time: "00:00 – 12:00" }
      : { person: rot.domNoite, label: "Domingo · Noite", time: "12:00 – 00:00" };
  }
  // Seg–Sex
  const today = WEEKDAY_SHIFTS[dow];
  if (h < 4) return { person: today[0].person, label: `${DOW[dow]} · Madrugada`, time: today[0].time };
  if (h < 9) return { person: today[1].person, label: `${DOW[dow]} · Manhã`, time: today[1].time };
  if (h >= 18) {
    if (dow === 5) return { person: today[2].person, label: "Sexta · Noite", time: today[2].time };
    if (h < 23) return { person: today[2].person, label: `${DOW[dow]} · Noite`, time: today[2].time };
    const next = WEEKDAY_SHIFTS[dow + 1];
    return { person: next[0].person, label: `${DOW[dow + 1]} · Madrugada`, time: next[0].time };
  }
  return null; // 09:00–18:00, horário comercial
}

// ─────────────────────────────────────────────────────────────
// COMPONENTES
// ─────────────────────────────────────────────────────────────

function PersonTag({ name, dim }) {
  const p = PEOPLE[name] || { color: "#555", bg: "#eee" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-bold"
      style={{ color: p.color, background: dim ? "transparent" : p.bg, opacity: dim ? 0.3 : 1 }}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
      {name}
    </span>
  );
}

export default function EscalaSobreaviso() {
  const [now, setNow] = useState(new Date());
  const [filter, setFilter] = useState(null); // nome ou null = todos
  const [monthKey, setMonthKey] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const schedule = useMemo(() => buildSchedule(), []);

  // Lista de meses disponíveis
  const months = useMemo(() => {
    const seen = new Map();
    schedule.forEach((d) => {
      const k = `${d.date.getFullYear()}-${d.date.getMonth()}`;
      if (!seen.has(k)) seen.set(k, { key: k, y: d.date.getFullYear(), m: d.date.getMonth() });
    });
    return [...seen.values()];
  }, [schedule]);

  // Mês padrão = mês de hoje (ou primeiro disponível)
  const activeMonth = monthKey || (() => {
    const k = `${now.getFullYear()}-${now.getMonth()}`;
    return months.some((m) => m.key === k) ? k : months[0].key;
  })();

  const monthDays = useMemo(
    () => schedule.filter((d) => `${d.date.getFullYear()}-${d.date.getMonth()}` === activeMonth),
    [schedule, activeMonth]
  );

  // Próximos plantões da pessoa filtrada
  const upcoming = useMemo(() => {
    if (!filter) return [];
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const rows = [];
    for (const d of schedule) {
      if (d.date < today) continue;
      d.shifts.forEach((s) => {
        if (s.person === filter) rows.push({ date: d.date, dow: d.dow, ...s, kind: "turno" });
      });
      if (d.folga === filter && d.dow === 6) {
        rows.push({ date: d.date, dow: d.dow, period: "Folga FDS", time: "Sáb + Dom", dur: "", person: filter, kind: "folga" });
      }
      if (rows.length >= 20) break;
    }
    return rows.slice(0, 20);
  }, [filter, schedule, now]);

  const onCall = currentOnCall(now);
  const onCallColor = onCall ? PEOPLE[onCall.person].color : "#94A3B8";

  const fmtDate = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const am = months.find((m) => m.key === activeMonth);

  return (
    <div className="min-h-screen" style={{ background: "#EEF1F6", fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#1E293B" }}>
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* CABEÇALHO */}
        <div className="rounded-2xl p-5 mb-5 text-white" style={{ background: "linear-gradient(135deg, #1E293B 0%, #334155 100%)" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest opacity-60 mb-1">Escala de Sobreaviso</div>
              <div className="text-2xl font-bold">
                {DOW[now.getDay()]}, {fmtDate(now)}/{now.getFullYear()}
              </div>
            </div>
            <div className="rounded-xl px-4 py-3 min-w-[200px]" style={{ background: "rgba(255,255,255,0.08)", borderLeft: `4px solid ${onCallColor}` }}>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-70">
                <span className="relative flex w-2 h-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: onCallColor }} />
                  <span className="relative inline-flex rounded-full w-2 h-2" style={{ background: onCallColor }} />
                </span>
                Agora
              </div>
              {onCall ? (
                <>
                  <div className="text-lg font-bold" style={{ color: onCallColor === "#37474F" ? "#CBD5E1" : onCallColor }}>{onCall.person}</div>
                  <div className="text-xs opacity-70">{onCall.label} · {onCall.time}</div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold opacity-90">Sem sobreaviso</div>
                  <div className="text-xs opacity-70">Horário comercial (09:00 – 18:00)</div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* FILTRO POR NOME */}
        <div className="mb-4">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Filtrar por responsável</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter(null)}
              className="px-3 py-1.5 rounded-full text-sm font-bold transition-all"
              style={{
                background: !filter ? "#1E293B" : "#fff",
                color: !filter ? "#fff" : "#475569",
                border: "1.5px solid " + (!filter ? "#1E293B" : "#CBD5E1"),
              }}
            >
              Todos
            </button>
            {Object.entries(PEOPLE).map(([name, p]) => (
              <button
                key={name}
                onClick={() => setFilter(filter === name ? null : name)}
                className="px-3 py-1.5 rounded-full text-sm font-bold transition-all"
                style={{
                  background: filter === name ? p.color : "#fff",
                  color: filter === name ? "#fff" : p.color,
                  border: `1.5px solid ${filter === name ? p.color : "#CBD5E1"}`,
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* PRÓXIMOS PLANTÕES (quando filtrado) */}
        {filter && (
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-5 border border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full" style={{ background: PEOPLE[filter].color }} />
              <h2 className="font-bold text-base">Próximos sobreavisos de {filter}</h2>
            </div>
            {upcoming.length === 0 ? (
              <div className="text-sm text-slate-500">Nenhum plantão encontrado no período.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {upcoming.map((u, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-slate-700 w-14">{fmtDate(u.date)}</span>
                      <span className="text-slate-500 w-10">{DOW_SHORT[u.dow]}</span>
                      {u.kind === "folga" ? (
                        <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ background: "#FEF9C3", color: "#854D0E" }}>
                          🏖 Folga FDS
                        </span>
                      ) : (
                        <span className="font-semibold" style={{ color: PEOPLE[filter].color }}>{u.period}</span>
                      )}
                    </div>
                    <span className="font-mono text-xs text-slate-500">{u.time}{u.dur ? ` · ${u.dur}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* NAVEGAÇÃO DE MESES */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: "thin" }}>
          {months.map((m) => (
            <button
              key={m.key}
              onClick={() => setMonthKey(m.key)}
              className="px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all"
              style={{
                background: activeMonth === m.key ? "#1E293B" : "#fff",
                color: activeMonth === m.key ? "#fff" : "#475569",
                border: "1px solid " + (activeMonth === m.key ? "#1E293B" : "#E2E8F0"),
              }}
            >
              {MONTHS_SHORT[m.m]}/{String(m.y).slice(2)}
            </button>
          ))}
        </div>

        {/* CALENDÁRIO DO MÊS */}
        <h2 className="font-bold text-lg mb-3">{am ? `${MONTHS[am.m]} de ${am.y}` : ""}</h2>
        <div className="space-y-2">
          {monthDays.map((d) => {
            const isToday = sameDay(d.date, now);
            const isWeekend = d.dow === 0 || d.dow === 6;
            const isPast = !isToday && d.date < now;
            const hasFiltered = !filter || d.shifts.some((s) => s.person === filter) || d.folga === filter;
            return (
              <div
                key={dayKey(d.date)}
                className="rounded-xl border bg-white overflow-hidden"
                style={{
                  borderColor: isToday ? "#1E293B" : "#E2E8F0",
                  borderWidth: isToday ? 2 : 1,
                  opacity: isPast ? 0.45 : filter && !hasFiltered ? 0.35 : 1,
                  background: isWeekend ? "#FDFBEF" : "#fff",
                }}
              >
                <div className="flex items-stretch">
                  {/* Data */}
                  <div
                    className="flex flex-col items-center justify-center w-16 shrink-0 py-3"
                    style={{ background: isWeekend ? "#F5EFD0" : "#F1F5F9", borderRight: "1px solid #E2E8F0" }}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{DOW_SHORT[d.dow]}</div>
                    <div className="text-xl font-bold text-slate-800 leading-tight">{String(d.date.getDate()).padStart(2, "0")}</div>
                    <div className="text-[10px] text-slate-400">{MONTHS_SHORT[d.date.getMonth()]}</div>
                    {isToday && <div className="mt-1 text-[9px] font-bold text-white bg-slate-800 rounded px-1.5 py-0.5">HOJE</div>}
                  </div>
                  {/* Turnos */}
                  <div className="flex-1 px-3 py-2">
                    {isWeekend && d.dow === 6 && (
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5" style={{ background: "#E2E8F0", color: "#475569" }}>
                          Semana {d.cycleWeek} do ciclo
                        </span>
                        <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background: "#FEF9C3", color: "#854D0E", opacity: filter && d.folga !== filter ? 0.4 : 1 }}>
                          🏖 Folga FDS: {d.folga}
                        </span>
                      </div>
                    )}
                    <div className="space-y-1">
                      {d.shifts.map((s, i) => {
                        const dim = filter && s.person !== filter;
                        return (
                          <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm" style={{ opacity: dim ? 0.3 : 1 }}>
                            <span className="w-24 font-semibold text-slate-600">{s.period}</span>
                            <span className="font-mono text-xs text-slate-500 w-28">{s.time}</span>
                            <span className="font-mono text-xs text-slate-400 w-7">{s.dur}</span>
                            <PersonTag name={s.person} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-center text-xs text-slate-400">
          Ciclo de fim de semana ancorado em 13/06/2026 (Semana 1) · Escala seg–sex fixa · 5 semanas de rotação
        </div>
      </div>
    </div>
  );
}
