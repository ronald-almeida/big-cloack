import { useCallback, useEffect, useRef, useState } from "react";

export const REFRESH_INTERVAL = 5000;

export async function getJSON(url, signal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (response.status === 401) window.location.assign("/login");
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Sua sessão expirou. Entre novamente.");
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Não foi possível atualizar.");
  return data;
}

// One request at a time; changes of filter discard the previous response.
// A manual refresh during a request queues another read after that request.
export default function useLiveQuery(key, load, enabled = true) {
  const loadRef = useRef(load),
    runRef = useRef(null);
  const [state, setState] = useState({});
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer,
      running = false,
      queued = false,
      previous = null;
    const available = () =>
      document.visibilityState !== "hidden" && navigator.onLine;
    async function run(manual = false) {
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      if (!available()) {
        setState((s) => ({
          ...s,
          key,
          status: navigator.onLine ? "paused" : "offline",
        }));
        return;
      }
      if (running) {
        queued ||= manual;
        return;
      }
      running = true;
      setState((s) => ({ ...s, key, status: "updating" }));
      const request = new AbortController();
      try {
        const signal = AbortSignal.any([
          controller.signal,
          request.signal,
          AbortSignal.timeout(30000),
        ]);
        const data = await loadRef.current(signal, previous);
        if (controller.signal.aborted) return;
        previous = data;
        setState({
          key,
          data,
          error: "",
          updatedAt: new Date(),
          status: available()
            ? "live"
            : navigator.onLine
              ? "paused"
              : "offline",
        });
      } catch (e) {
        if (!controller.signal.aborted)
          setState((s) => ({
            ...s,
            key,
            error: e.message,
            status: navigator.onLine ? "error" : "offline",
          }));
      } finally {
        request.abort();
        running = false;
        if (!controller.signal.aborted) {
          if (queued) {
            queued = false;
            void run();
          } else if (available()) timer = setTimeout(run, REFRESH_INTERVAL);
        }
      }
    }
    const resume = () => {
      void run(true);
    };
    runRef.current = resume;
    setState((s) => ({
      key,
      status: "updating",
      previousData: s.data || s.previousData,
    }));
    void run();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    return () => {
      controller.abort();
      clearTimeout(timer);
      runRef.current = null;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
    };
  }, [key, enabled]);
  const refresh = useCallback(() => runRef.current?.(), []);
  const current = state.key === key && enabled ? state : {};
  return {
    ...current,
    previousData: state.data || state.previousData,
    loading: enabled && !current.data && !current.error,
    refresh,
  };
}
