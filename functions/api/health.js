// Demo server check. A successful check does not mean CSV data is up-to-date.
export async function onRequestGet() {
  return Response.json({
    ok: true,
    mode: 'demo',
    database_connected: false,
    data_version: 'demo-v1',
    checked_at: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
