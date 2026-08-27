// Container healthcheck. Exits 0 when the app answers /api/health.
const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
