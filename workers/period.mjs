export function period(params) {
  const from = params.get("from"),
    to = params.get("to");
  if (params.get("period") === "all") {
    if (from || to) throw new Error("Máximo não aceita datas adicionais.");
    return {
      from: "0000-01-01T00:00:00.000Z",
      to: new Date(Date.now() + 1).toISOString(),
    };
  }
  if (from || to) {
    const a = Date.parse(from),
      b = Date.parse(to);
    if (
      !from ||
      !to ||
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a >= b ||
      b - a > 367 * 86400000
    )
      throw new Error("Selecione um período válido de até 366 dias.");
    return { from: new Date(a).toISOString(), to: new Date(b).toISOString() };
  }
  const days = [1, 7, 30, 90].includes(Number(params.get("days")))
    ? Number(params.get("days"))
    : 30;
  const end = new Date();
  end.setUTCHours(24, 0, 0, 0);
  return {
    from: new Date(+end - days * 86400000).toISOString(),
    to: end.toISOString(),
  };
}
