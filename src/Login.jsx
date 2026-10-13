import React, { useState } from "react";
import "./login.css";
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Não foi possível entrar.");
      window.location.replace("/");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          bigcloak<span>.</span>
        </div>
        <h1 id="login-title">Bem-vindo de volta</h1>
        <p>Entre para gerenciar seus links e sites.</p>
        <form onSubmit={submit}>
          <label>
            E-mail
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              autoFocus
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={128}
            />
          </label>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <button className="login-submit" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : "Entrar"}
          </button>
        </form>
        <p className="login-note">
          Sua sessão permanece ativa por até 7 dias neste navegador.
        </p>
        <p className="login-note">
          Para definir ou recuperar sua senha, contate o responsável pela
          administração do sistema.
        </p>
      </section>
    </main>
  );
}
export function SessionActions() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok && response.status !== 401)
        throw Error("Não foi possível sair. Tente novamente.");
      window.location.replace("/login");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="session-actions">
      <button onClick={logout} disabled={busy}>
        {busy ? "Saindo…" : "Sair"}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
