import React from "react";
import { TRAFFIC_CLASSES, BOT_PROVIDERS } from "../shared/traffic.mjs";
export default function TrafficFilters({ filters, onChange }) {
  return (
    <>
      <label>
        Classificação
        <select
          value={filters.classification || ""}
          onChange={(e) => onChange("classification", e.target.value)}
        >
          <option value="">Todas</option>
          {Object.entries(TRAFFIC_CLASSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Provider provável
        <select
          value={filters.bot_provider || ""}
          onChange={(e) => onChange("bot_provider", e.target.value)}
        >
          <option value="">Todos</option>
          {Object.entries(BOT_PROVIDERS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Método
        <select
          value={filters.request_method || ""}
          onChange={(e) => onChange("request_method", e.target.value)}
        >
          <option value="">GET e HEAD</option>
          <option value="GET">GET</option>
          <option value="HEAD">HEAD</option>
        </select>
      </label>
    </>
  );
}
