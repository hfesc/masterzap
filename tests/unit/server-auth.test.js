import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { isEmailAllowed, createAuthRouter } from '../../server/auth.js';
import { createApp } from '../../server/index.js';

describe('isEmailAllowed', () => {
  it('permite qualquer e-mail quando nenhuma restrição de e-mail ou domínio está configurada', () => {
    expect(isEmailAllowed('user@example.com', [], [])).toBe(true);
    expect(isEmailAllowed('test@gmail.com', null, null)).toBe(true);
    expect(isEmailAllowed('outro@empresa.com.br')).toBe(true);
  });

  it('permite e-mail que consta na lista de ALLOWED_EMAILS (case-insensitive)', () => {
    const allowedEmails = ['admin@hfesc.dev', 'colab@empresa.com'];
    expect(isEmailAllowed('admin@hfesc.dev', allowedEmails, [])).toBe(true);
    expect(isEmailAllowed('ADMIN@HFESC.DEV', allowedEmails, [])).toBe(true);
    expect(isEmailAllowed('outro@hfesc.dev', allowedEmails, [])).toBe(false);
  });

  it('permite e-mail cujo domínio consta em ALLOWED_DOMAINS (case-insensitive)', () => {
    const allowedDomains = ['hfesc.dev', 'apple.com'];
    expect(isEmailAllowed('qualquer@hfesc.dev', [], allowedDomains)).toBe(true);
    expect(isEmailAllowed('fulano@APPLE.COM', [], allowedDomains)).toBe(true);
    expect(isEmailAllowed('hacker@gmail.com', [], allowedDomains)).toBe(false);
  });

  it('permite quando atende a ALLOWED_EMAILS ou ALLOWED_DOMAINS quando ambos são fornecidos', () => {
    const allowedEmails = ['convidado@externo.org'];
    const allowedDomains = ['hfesc.dev'];
    expect(isEmailAllowed('convidado@externo.org', allowedEmails, allowedDomains)).toBe(true);
    expect(isEmailAllowed('time@hfesc.dev', allowedEmails, allowedDomains)).toBe(true);
    expect(isEmailAllowed('intruso@outro.com', allowedEmails, allowedDomains)).toBe(false);
  });

  it('rejeita e-mails inválidos ou vazios', () => {
    expect(isEmailAllowed('', ['admin@hfesc.dev'], [])).toBe(false);
    expect(isEmailAllowed(null, [], [])).toBe(false);
    expect(isEmailAllowed('sem-arroba', [], [])).toBe(false);
  });
});

describe('Servidor Express e Autenticação Google', () => {
  let app;
  let mockExchangeTokens;
  let mockVerifyIdToken;

  beforeEach(() => {
    mockExchangeTokens = vi.fn().mockResolvedValue({
      access_token: 'mock-access-token',
      id_token: 'mock-id-token',
    });

    mockVerifyIdToken = vi.fn().mockResolvedValue({
      email: 'user@hfesc.dev',
      email_verified: true,
      name: 'Usuário Teste',
      picture: 'https://example.com/photo.jpg',
      sub: 'google-sub-123',
    });

    app = createApp({
      sessionSecret: 'test-secret-at-least-32-chars-long-abcdef',
      googleClientId: 'mock-client-id.apps.googleusercontent.com',
      googleClientSecret: 'mock-client-secret',
      googleRedirectUri: 'http://localhost:3000/auth/google/callback',
      allowedEmails: [],
      allowedDomains: [],
      exchangeCodeForTokens: mockExchangeTokens,
      verifyIdToken: mockVerifyIdToken,
    });
  });

  it('GET /healthz retorna 200 OK com status e sem exigir autenticação', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('possui headers de segurança estritos (Helmet CSP e Referrer-Policy no-referrer)', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('GET /auth/login renderiza a tela de login com botão Google e sem telemetria', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('MasterWhats');
    expect(res.text).toContain('/auth/google');
    expect(res.text).toContain('Entrar com Google');
    expect(res.text).toContain('content="no-referrer"');
  });

  it('GET /auth/login exibe aviso se houver erro nos query params', async () => {
    const res = await request(app).get('/auth/login?error=unverified_email');
    expect(res.status).toBe(200);
    expect(res.text).toContain('e-mail verificado');
  });

  it('GET /auth/google inicia o fluxo OAuth gerando state/nonce e redirecionando para o Google', async () => {
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(302);
    const location = res.headers.location;
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('client_id=mock-client-id.apps.googleusercontent.com');
    expect(location).toContain('scope=openid+email+profile');
    expect(location).toContain('state=');
    expect(location).toContain('nonce=');

    // Cookie de sessão deve estar configurado
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('GET /auth/google/callback rejeita requisição sem state válido', async () => {
    const res = await request(app).get('/auth/google/callback?code=mock-code&state=invalid-state');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/login?error=invalid_state');
  });

  it('GET /auth/google/callback rejeita usuário com e-mail não verificado pelo Google', async () => {
    // Primeiro obtemos o cookie de sessão com o state gerado
    const agent = request.agent(app);
    const googleRes = await agent.get('/auth/google');
    const location = googleRes.headers.location;
    const url = new URL(location);
    const state = url.searchParams.get('state');

    mockVerifyIdToken.mockResolvedValueOnce({
      email: 'hacker@unverified.org',
      email_verified: false,
      name: 'Unverified User',
      sub: 'google-sub-999',
    });

    const callbackRes = await agent.get(`/auth/google/callback?code=valid-code&state=${state}`);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toContain('/auth/login?error=unverified_email');
  });

  it('GET /auth/google/callback rejeita e-mail bloqueado pela allowlist quando configurada', async () => {
    const restrictedApp = createApp({
      sessionSecret: 'test-secret-at-least-32-chars-long-abcdef',
      googleClientId: 'mock-client-id.apps.googleusercontent.com',
      googleClientSecret: 'mock-client-secret',
      googleRedirectUri: 'http://localhost:3000/auth/google/callback',
      allowedEmails: ['authorized@hfesc.dev'],
      allowedDomains: [],
      exchangeCodeForTokens: mockExchangeTokens,
      verifyIdToken: mockVerifyIdToken,
    });

    const agent = request.agent(restrictedApp);
    const googleRes = await agent.get('/auth/google');
    const state = new URL(googleRes.headers.location).searchParams.get('state');

    mockVerifyIdToken.mockResolvedValueOnce({
      email: 'unauthorized@gmail.com',
      email_verified: true,
      name: 'Outro Usuário',
      sub: 'google-sub-456',
    });

    const callbackRes = await agent.get(`/auth/google/callback?code=valid-code&state=${state}`);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toContain('/auth/login?error=forbidden');
  });

  it('GET /auth/google/callback autentica com sucesso, armazena sessão e redireciona para a home', async () => {
    const agent = request.agent(app);
    const googleRes = await agent.get('/auth/google');
    const authUrl = new URL(googleRes.headers.location);
    const state = authUrl.searchParams.get('state');
    const nonce = authUrl.searchParams.get('nonce');

    const callbackRes = await agent.get(`/auth/google/callback?code=valid-code&state=${state}`);
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe('/');
    expect(mockVerifyIdToken).toHaveBeenCalledWith('mock-id-token', nonce);

    const cookies = callbackRes.headers['set-cookie'].join('');
    expect(cookies).not.toContain('user%40hfesc.dev');

    const meRes = await agent.get('/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({ authenticated: true });
  });

  it('GET /auth/logout não encerra a sessão', async () => {
    const res = await request(app).get('/auth/logout');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });

  it('POST /auth/logout rejeita origem externa', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('POST /auth/logout encerra a sessão e redireciona para /auth/login', async () => {
    const agent = request.agent(app);
    const googleRes = await agent.get('/auth/google');
    const state = new URL(googleRes.headers.location).searchParams.get('state');
    await agent.get(`/auth/google/callback?code=valid-code&state=${state}`);

    const logoutRes = await agent.post('/auth/logout');
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.location).toBe('/auth/login');

    const meRes = await agent.get('/auth/me');
    expect(meRes.status).toBe(401);
    expect(meRes.body.authenticated).toBe(false);
  });

  it('bloqueia requisições não autenticadas a rotas privadas', async () => {
    // Rota HTML redireciona para login
    const htmlRes = await request(app).get('/chat/alexandre-de-moraes');
    expect(htmlRes.status).toBe(302);
    expect(htmlRes.headers.location).toBe('/auth/login');

    // Rota de dados/API retorna 401 JSON
    const dataRes = await request(app).get('/data/conversations.json');
    expect(dataRes.status).toBe(401);
    expect(dataRes.body.error).toBe('unauthorized');
    expect(dataRes.body.login_url).toBe('/auth/login');
  });

  it('previne redirecionamento aberto (open redirect) no returnTo', async () => {
    const agent = request.agent(app);
    const googleRes = await agent.get('/auth/google?returnTo=//evil.com/phishing');
    const state = new URL(googleRes.headers.location).searchParams.get('state');

    const callbackRes = await agent.get(`/auth/google/callback?code=valid-code&state=${state}`);
    expect(callbackRes.status).toBe(302);
    // Deve ignorar o host externo e redirecionar para a raiz '/'
    expect(callbackRes.headers.location).toBe('/');
  });
});
