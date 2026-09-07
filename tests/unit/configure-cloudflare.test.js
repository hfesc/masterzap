import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createHeaderRemovalRule,
  getResponseHeaderRuleset,
  configureResponseHeaderTransforms,
  TELEMETRY_HEADERS_RULE_DESC,
  getZoneId,
  getDnsRecord,
  upsertDnsRecord,
  configureSslTls,
} from '../../scripts/configure-cloudflare.mjs';

describe('Cloudflare Automation & Response Header Transforms', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('createHeaderRemovalRule', () => {
    it('creates a ruleset rule that removes nel, report-to, and reporting-endpoints', () => {
      const rule = createHeaderRemovalRule('masterzap.hfesc.dev');
      expect(rule.action).toBe('rewrite');
      expect(rule.action_parameters).toEqual({
        headers: {
          'nel': { operation: 'remove' },
          'report-to': { operation: 'remove' },
          'reporting-endpoints': { operation: 'remove' },
        },
      });
      expect(rule.expression).toBe('(http.host eq "masterzap.hfesc.dev")');
      expect(rule.description).toBe(TELEMETRY_HEADERS_RULE_DESC);
      expect(rule.enabled).toBe(true);
    });

    it('allows custom hostname for rule expression', () => {
      const rule = createHeaderRemovalRule('custom.domain.com');
      expect(rule.expression).toBe('(http.host eq "custom.domain.com")');
    });
  });

  describe('getResponseHeaderRuleset', () => {
    it('returns null when entrypoint ruleset does not exist (404)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          errors: [{ code: 10007, message: 'ruleset not found' }],
        }),
      });

      const result = await getResponseHeaderRuleset('fake-token', 'zone-123');
      expect(result).toBeNull();
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/zone-123/rulesets/phases/http_response_headers_transform/entrypoint',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer fake-token',
          }),
        })
      );
    });

    it('returns existing ruleset when present (200)', async () => {
      const mockRuleset = {
        id: 'ruleset-abc',
        phase: 'http_response_headers_transform',
        rules: [
          { id: 'r1', description: 'Existing rule', expression: 'true' },
        ],
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: mockRuleset,
        }),
      });

      const result = await getResponseHeaderRuleset('fake-token', 'zone-123');
      expect(result).toEqual(mockRuleset);
    });

    it('throws error if API returns non-404 failure', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          errors: [{ code: 10000, message: 'internal server error' }],
        }),
      });

      await expect(getResponseHeaderRuleset('fake-token', 'zone-123')).rejects.toThrow('Cloudflare API Error [500]');
    });
  });

  describe('configureResponseHeaderTransforms', () => {
    it('creates new ruleset entrypoint when no existing ruleset exists', async () => {
      // 1. getResponseHeaderRuleset -> 404
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          errors: [{ code: 10007, message: 'ruleset not found' }],
        }),
      });

      // 2. PUT entrypoint with new rule
      const createdRuleset = {
        id: 'new-ruleset-id',
        rules: [createHeaderRemovalRule('masterzap.hfesc.dev')],
      };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: createdRuleset,
        }),
      });

      const res = await configureResponseHeaderTransforms('fake-token', 'zone-123', {
        hostname: 'masterzap.hfesc.dev',
      });

      expect(res).toEqual(createdRuleset);

      // Verify second fetch was PUT with rules array containing only our rule
      const putCall = global.fetch.mock.calls[1];
      expect(putCall[0]).toBe('https://api.cloudflare.com/client/v4/zones/zone-123/rulesets/phases/http_response_headers_transform/entrypoint');
      expect(putCall[1].method).toBe('PUT');
      const sentBody = JSON.parse(putCall[1].body);
      expect(sentBody.rules).toHaveLength(1);
      expect(sentBody.rules[0].description).toBe(TELEMETRY_HEADERS_RULE_DESC);
      expect(sentBody.rules[0].action_parameters.headers).toEqual({
        'nel': { operation: 'remove' },
        'report-to': { operation: 'remove' },
        'reporting-endpoints': { operation: 'remove' },
      });
    });

    it('updates existing ruleset by preserving unrelated rules and replacing the telemetry removal rule', async () => {
      const existingRule1 = { id: 'r1', description: 'Keep this header', action: 'rewrite' };
      const oldTelemetryRule = { id: 'r2', description: TELEMETRY_HEADERS_RULE_DESC, action: 'rewrite' };

      // 1. getResponseHeaderRuleset -> returns existing ruleset
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            id: 'ruleset-123',
            rules: [existingRule1, oldTelemetryRule],
          },
        }),
      });

      // 2. PUT entrypoint
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            id: 'ruleset-123',
            rules: [existingRule1, createHeaderRemovalRule('masterzap.hfesc.dev')],
          },
        }),
      });

      await configureResponseHeaderTransforms('fake-token', 'zone-123', {
        hostname: 'masterzap.hfesc.dev',
      });

      const putCall = global.fetch.mock.calls[1];
      const sentBody = JSON.parse(putCall[1].body);
      expect(sentBody.rules).toHaveLength(2);
      expect(sentBody.rules[0]).toEqual(existingRule1);
      expect(sentBody.rules[1].description).toBe(TELEMETRY_HEADERS_RULE_DESC);
    });
  });

  describe('getZoneId, getDnsRecord, upsertDnsRecord, configureSslTls', () => {
    it('getZoneId returns zone id from active zones list', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [{ id: 'target-zone-id', name: 'hfesc.dev' }],
        }),
      });

      const id = await getZoneId('token', 'hfesc.dev');
      expect(id).toBe('target-zone-id');
    });

    it('getDnsRecord returns null if no CNAME record found', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [],
        }),
      });

      const record = await getDnsRecord('token', 'zone-123', 'test.domain.com');
      expect(record).toBeNull();
    });

    it('upsertDnsRecord updates record when target or proxied differs', async () => {
      // 1. getDnsRecord
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [{ id: 'rec-1', content: 'old.herokudns.com', proxied: false }],
        }),
      });

      // 2. PUT update
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { id: 'rec-1', content: 'new.herokudns.com', proxied: true },
        }),
      });

      const res = await upsertDnsRecord('token', 'zone-123', {
        name: 'masterzap.hfesc.dev',
        target: 'new.herokudns.com',
        proxied: true,
      });

      expect(res.content).toBe('new.herokudns.com');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/zone-123/dns_records/rec-1',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('configureSslTls applies strict SSL, Always Use HTTPS and TLS 1.2', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: { value: 'strict' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: { value: 'on' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: { value: '1.2' } }),
        });

      const result = await configureSslTls('token', 'zone-123');
      expect(result).toEqual({
        ssl: 'strict',
        alwaysUseHttps: 'on',
        minTlsVersion: '1.2',
      });
    });
  });
});
