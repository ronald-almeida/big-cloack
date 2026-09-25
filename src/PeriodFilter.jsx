import React from "react";
export function periodQuery(value) {
  const end = new Date(),
    start = new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(24, 0, 0, 0);
  if (value.preset === "custom") {
    if (!value.from || !value.to) return "";
    const a = new Date(value.from + "T00:00:00"),
      b = new Date(value.to + "T00:00:00");
    b.setDate(b.getDate() + 1);
    if (
      !Number.isFinite(+a) ||
      !Number.isFinite(+b) ||
      a >= b ||
      b - a > 367 * 86400000
    )
      return "";
    return new URLSearchParams({
      from: a.toISOString(),
      to: b.toISOString(),
    }).toString();
  }
  start.setDate(start.getDate() - Number(value.preset) + 1);
  return new URLSearchParams({
    from: start.toISOString(),
    to: end.toISOString(),
  }).toString();
}
export default function PeriodFilter({ value, onChange }) {
  return (
    <div className="period-filter">
      <select
        aria-label="Período"
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value })}
      >
        <option value="1">Hoje</option>
        <option value="7">Últimos 7 dias</option>
        <option value="30">Últimos 30 dias</option>
        <option value="custom">Personalizado</option>
      </select>
      {value.preset === "custom" && (
        <div className="period-dates">
          <label>
            Data inicial
            <input
              type="date"
              value={value.from}
              onInput={(e) => onChange({ ...value, from: e.target.value })}
            />
          </label>
          <label>
            Data final
            <input
              type="date"
              value={value.to}
              onInput={(e) => onChange({ ...value, to: e.target.value })}
            />
          </label>
          <small>Inclui a data final. Até 366 dias.</small>
        </div>
      )}
      <small>Fuso: {Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
      {!periodQuery(value) && (
        <p role="status">
          Escolha as datas inicial e final de um período válido.
        </p>
      )}
    </div>
  );
}
