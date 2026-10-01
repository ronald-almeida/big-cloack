import React, { useState } from "react";
import "./login.css";
export default function Login() {
  const recovery = window.location.pathname.startsWith("/access-recovery");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (recovery && password !== confirm) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        recovery ? "/access-recovery/api" : "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw Error(
          "Sua confirmação expirou. Atualize a página para continuar.",
        );
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
        <h1 id="login-title">
          {recovery ? "Definir sua senha" : "Bem-vindo de volta"}
        </h1>
        <p>
          {recovery
            ? "Seu e-mail foi confirmado. Escolha a senha que usará para entrar no painel."
            : "Entre para gerenciar seus links e sites."}
        </p>
        <form onSubmit={submit}>
          {!recovery && (
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
          )}
          <label>
            {recovery ? "Nova senha" : "Senha"}
            <input
              type="password"
              autoComplete={recovery ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={recovery ? 12 : undefined}
              maxLength={128}
              autoFocus={recovery}
              aria-describedby={recovery ? "password-help" : undefined}
            />
          </label>
          {recovery && (
            <>
              <small id="password-help">
                Use pelo menos 12 caracteres. Você pode usar uma frase fácil de
                lembrar.
              </small>
              <label>
                Confirmar senha
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
            </>
          )}
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <button className="login-submit" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : recovery ? "Salvar senha e entrar" : "Entrar"}
          </button>
        </form>
        {!recovery && (
          <a className="login-recovery" href="/access-recovery">
            Primeiro acesso ou esqueceu a senha?
          </a>
        )}
        <p className="login-note">
          {recovery
            ? "Ao salvar, as sessões anteriores serão encerradas."
            : "Sua sessão permanece ativa por até 7 dias neste navegador."}
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
      if (!response.ok) throw Error("Não foi possível sair. Tente novamente.");
      window.location.replace("/login");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="session-actions">
      <a href="/access-recovery">Alterar senha</a>
      <button onClick={logout} disabled={busy}>
        {busy ? "Saindo…" : "Sair"}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
