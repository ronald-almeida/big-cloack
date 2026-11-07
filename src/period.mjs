export function periodQuery(value, now = new Date()) {
  if (value.preset === "all") return "period=all";
  const start = new Date(now),
    end = new Date(now);
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
  if (value.preset === "yesterday") {
    end.setTime(+start);
    start.setDate(start.getDate() - 1);
  } else {
    if (!["1", "7", "30"].includes(value.preset)) return "";
    start.setDate(start.getDate() - Number(value.preset) + 1);
  }
  return new URLSearchParams({
    from: start.toISOString(),
    to: end.toISOString(),
  }).toString();
}
