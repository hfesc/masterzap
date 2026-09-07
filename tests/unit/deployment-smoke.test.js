import { describe, it, expect, vi } from 'vitest';
import {
  verifyHealthz,
  verifyAuthRedirect,
  verifyNoTelemetryHeaders,
  runDeploymentSmoke,
  FORBIDDEN_EDGE_HEADERS,
} from '../../scripts/deployment-smoke.mjs';

describe('deployment-smoke', () => {
  const targetUrl = 'https://masterzap.hfesc.dev';

  describe('verifyNoTelemetryHeaders', () => {
    it('passa quando nenhum header de telemetria ou reporting está presente', () => {
      const headers = new Headers({
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'cf-ray': '1234567890abcdef',
      });
      expect(() => verifyNoTelemetryHeaders(headers, 'https://masterzap.hfesc.dev/healthz')).not.toThrow();
    });

    it('falha quando nel está presente nos headers', () => {
      const headers = new Headers({
        'nel': '{"report_to":"heroku-nel","max_age":3600}',
      });
      expect(() => verifyNoTelemetryHeaders(headers, 'https://masterzap.hfesc.dev/healthz'))
        .toThrow(/Header de telemetria proibido detectado: nel/);
    });

    it('falha quando report-to ou reporting-endpoints está presente nos headers', () => {
      const headers1 = new Headers({
        'report-to': '{"group":"heroku-nel","max_age":3600,"endpoints":[{"url":"https://nel.heroku.com"}]}',
      });
      expect(() => verifyNoTelemetryHeaders(headers1, 'https://masterzap.hfesc.dev/healthz'))
        .toThrow(/Header de telemetria proibido detectado: report-to/);

      const headers2 = new Headers({
        'reporting-endpoints': 'heroku-nel="https://nel.heroku.com"',
      });
      expect(() => verifyNoTelemetryHeaders(headers2, 'https://masterzap.hfesc.dev/healthz'))
        .toThrow(/Header de telemetria proibido detectado: reporting-endpoints/);
    });
  });

  describe('verifyHealthz', () => {
    it('valida endpoint /healthz com sucesso (HTTP 200, status: ok)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'ok', uptime: 123.45 }),
      });

      const result = await verifyHealthz(targetUrl, { fetch: mockFetch });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ status: 'ok', uptime: 123.45 });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://masterzap.hfesc.dev/healthz',
        expect.objectContaining({ method: 'GET', redirect: 'manual' })
      );
    });

    it('falha se /healthz retornar status diferente de 200', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => 'Service Unavailable',
      });

      await expect(verifyHealthz(targetUrl, { fetch: mockFetch }))
        .rejects.toThrow(/\/healthz retornou HTTP 503/);
    });

    it('falha se /healthz retornar payload inválido', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ status: 'degraded' }),
      });

      await expect(verifyHealthz(targetUrl, { fetch: mockFetch }))
        .rejects.toThrow(/\/healthz payload inválido/);
    });

    it('falha se /healthz contiver headers de telemetria', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ nel: '{"report_to":"heroku-nel"}' }),
        json: async () => ({ status: 'ok' }),
      });

      await expect(verifyHealthz(targetUrl, { fetch: mockFetch }))
        .rejects.toThrow(/Header de telemetria proibido detectado: nel/);
    });
  });

  describe('verifyAuthRedirect', () => {
    it('valida redirecionamento de raiz não autenticada para /auth/login e fluxo OAuth', async () => {
      const mockFetch = vi.fn()
        // 1. GET / -> 302 Location: /auth/login
        .mockResolvedValueOnce({
          status: 302,
          headers: new Headers({
            location: '/auth/login',
          }),
        })
        // 2. GET /auth/login -> 200 com link /auth/google
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html>...<a href="/auth/google">Entrar com Google</a>...</html>',
        })
        // 3. GET /auth/google -> 302 Location: https://accounts.google.com/o/oauth2/v2/auth?...
        .mockResolvedValueOnce({
          status: 302,
          headers: new Headers({
            location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=xyz&response_type=code',
          }),
        });

      const result = await verifyAuthRedirect(targetUrl, { fetch: mockFetch });
      expect(result.success).toBe(true);
      expect(result.finalOAuthUrl).toContain('accounts.google.com');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('aceita redirecionamento direto para Google OAuth quando aplicável', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        status: 302,
        headers: new Headers({
          location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=xyz',
        }),
      });

      const result = await verifyAuthRedirect(targetUrl, { fetch: mockFetch });
      expect(result.success).toBe(true);
      expect(result.finalOAuthUrl).toContain('accounts.google.com');
    });

    it('falha se a raiz retornar erro 5xx', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
      });

      await expect(verifyAuthRedirect(targetUrl, { fetch: mockFetch }))
        .rejects.toThrow(/HTTP 500/);
    });

    it('falha se o redirecionamento contiver headers de telemetria', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        status: 302,
        headers: new Headers({
          location: '/auth/login',
          'report-to': '{"endpoint":"https://nel.heroku.com"}',
        }),
      });

      await expect(verifyAuthRedirect(targetUrl, { fetch: mockFetch }))
        .rejects.toThrow(/Header de telemetria proibido detectado: report-to/);
    });
  });

  describe('runDeploymentSmoke', () => {
    it('executa todas as verificações com sucesso', async () => {
      const mockFetch = vi.fn()
        // /healthz
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: 'ok' }),
        })
        // /
        .mockResolvedValueOnce({
          status: 302,
          headers: new Headers({ location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=xyz' }),
        });

      const result = await runDeploymentSmoke(targetUrl, { fetch: mockFetch });
      expect(result.ok).toBe(true);
      expect(result.checks.healthz).toBeDefined();
      expect(result.checks.authRedirect).toBeDefined();
    });
  });
});
