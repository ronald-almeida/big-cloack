import React from "react";
import { periodQuery } from "./period.mjs";
export { periodQuery } from "./period.mjs";
export default function PeriodFilter({ value, onChange }) {
  return (
    <div className="period-filter">
      <select
        aria-label="Período"
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value })}
      >
        <option value="1">Hoje</option>
        <option value="yesterday">Ontem</option>
        <option value="7">Últimos 7 dias</option>
        <option value="30">Últimos 30 dias</option>
        <option value="all">Máximo</option>
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
