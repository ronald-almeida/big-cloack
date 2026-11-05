import React from "react";

export default function LiveStatus({ status, updatedAt }) {
  const message =
    status === "offline"
      ? "Sem conexão — aguardando reconexão"
      : status === "error"
        ? "Falha na atualização — tentando novamente"
        : status === "paused"
          ? "Atualização pausada enquanto a aba está oculta"
          : status === "updating"
            ? "Atualizando acessos…"
            : "Atualização automática a cada 5 s";
  return (
    <p className="live-status" role="status">
      <span className={`live-dot ${status || "updating"}`} aria-hidden="true" />
      {message}
      {updatedAt && (
        <span>
          Última atualização:{" "}
          <time dateTime={updatedAt.toISOString()}>
            {updatedAt.toLocaleTimeString("pt-BR")}
          </time>
        </span>
      )}
    </p>
  );
}
