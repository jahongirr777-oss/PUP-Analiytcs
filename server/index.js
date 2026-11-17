const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/health') {
      if (!['GET', 'HEAD'].includes(request.method)) {
        return Response.json({ error: 'method_not_allowed' }, {
          status: 405, headers: { ...headers, Allow: 'GET, HEAD' },
        });
      }
      // Liveness only. Do not spend database reads on public polling or claim
      // that a successful response means an import has completed.
      const body = JSON.stringify({
        ok: true, mode: 'demo', database_connected: false,
        data_version: 'demo-v1', checked_at: new Date().toISOString(),
      });
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      // No client data routes until authentication AND authorization exist.
      // Never let a missing API route become a 200 HTML SPA response.
      return Response.json({ error: 'data_api_not_enabled' }, { status: 503, headers });
    }
    return env.ASSETS.fetch(request);
  },
};
