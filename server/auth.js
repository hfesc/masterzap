/**
 * Módulo de Autenticação Google OAuth 2.0 / OpenID Connect para o MasterWhats.
 *
 * - Validação estrita de CSRF via state e replay via nonce
 * - Enforcement de email_verified: true
 * - Suporte a allowlist opcional por e-mail e por domínio
 * - Sessão assinada via cookie-session
 * - Interface de login estilizada no padrão WhatsApp, 100% self-hosted e sem telemetria
 */

import express from 'express';
import crypto from 'node:crypto';

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

function decodeBase64UrlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

async function verifyGoogleIdToken(idToken, expectedNonce, clientId) {
  if (!idToken) throw new Error('Google não retornou id_token');

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Google retornou id_token inválido');

  const header = decodeBase64UrlJson(parts[0]);
  const payload = decodeBase64UrlJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Algoritmo do id_token inválido');

  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!response.ok) throw new Error(`Google certificates fetch falhou com status ${response.status}`);
  const { keys = [] } = await response.json();
  const jwk = keys.find(key => key.kid === header.kid && key.alg === 'RS256' && key.use === 'sig');
  if (!jwk) throw new Error('Chave de assinatura do Google não encontrada');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const validSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url'),
  );

  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!validSignature ||
      !GOOGLE_ISSUERS.has(payload.iss) ||
      !audience.includes(clientId) ||
      payload.exp <= now ||
      payload.iat > now + 60 ||
      payload.nonce !== expectedNonce) {
    throw new Error('Claims do id_token inválidas');
  }

  return payload;
}

/**
 * Verifica se um e-mail é permitido segundo as listas de restrição.
 * Se nenhuma lista estiver configurada, permite qualquer e-mail válido.
 */
export function isEmailAllowed(email, allowedEmails = [], allowedDomains = []) {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return false;

  const emails = (allowedEmails || [])
    .map(e => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter(Boolean);

  const domains = (allowedDomains || [])
    .map(d => (typeof d === 'string' ? d.trim().toLowerCase().replace(/^@/, '') : ''))
    .filter(Boolean);

  // Se nenhuma restrição foi configurada, qualquer conta é aceita
  if (emails.length === 0 && domains.length === 0) {
    return true;
  }

  // Permite se constar explicitamente na lista de e-mails
  if (emails.length > 0 && emails.includes(normalized)) {
    return true;
  }

  // Permite se o domínio constar na lista de domínios
  const domain = normalized.split('@')[1];
  if (domains.length > 0 && domains.includes(domain)) {
    return true;
  }

  return false;
}

/**
 * Sanitiza a URL de retorno para prevenir vulnerabilidade de Open Redirect.
 */
export function sanitizeReturnTo(url) {
  if (typeof url !== 'string') return '/';
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) {
    return url;
  }
  return '/';
}

/**
 * Gera o HTML da página de login.
 * Totalmente estático, sem scripts externos ou fontes de terceiros, com meta referrer no-referrer.
 */
function renderLoginPage(error) {
  let errorMessage = '';
  if (error === 'unverified_email') {
    errorMessage = 'A conta Google utilizada não possui e-mail verificado. Por segurança, utilize uma conta com e-mail verificado.';
  } else if (error === 'forbidden') {
    errorMessage = 'Acesso não autorizado para esta conta. Este repositório está restrito aos usuários autorizados.';
  } else if (error === 'invalid_state') {
    errorMessage = 'Sessão de autenticação expirada ou inválida. Por favor, tente novamente.';
  } else if (error === 'oauth_error') {
    errorMessage = 'Ocorreu um erro durante a comunicação com o Google. Tente novamente.';
  } else if (error === 'unauthorized') {
    errorMessage = 'Você precisa entrar com sua conta Google para visualizar o acervo.';
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>MasterWhats — Entrar</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #111b21;
      color: #e9edef;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .login-card {
      background-color: #202c33;
      border-radius: 12px;
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 12px 28px rgba(0,0,0,0.4);
      border: 1px solid #2a3942;
    }
    .logo-container {
      margin-bottom: 1.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      background-color: #00a884;
      border-radius: 50%;
    }
    .logo-container svg {
      width: 38px;
      height: 38px;
      fill: #ffffff;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #e9edef;
    }
    p.subtitle {
      font-size: 0.9rem;
      color: #8696a0;
      margin-bottom: 2rem;
      line-height: 1.4;
    }
    .error-alert {
      background-color: rgba(239, 68, 68, 0.15);
      border: 1px solid #ef4444;
      color: #fca5a5;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 1.5rem;
      line-height: 1.4;
      text-align: left;
    }
    .btn-google {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      padding: 0.75rem 1.25rem;
      background-color: #ffffff;
      color: #1f1f1f;
      font-size: 0.95rem;
      font-weight: 500;
      border-radius: 24px;
      text-decoration: none;
      transition: background-color 0.2s, box-shadow 0.2s;
      border: none;
      cursor: pointer;
    }
    .btn-google:hover {
      background-color: #f1f3f4;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .btn-google svg {
      width: 20px;
      height: 20px;
    }
    .footer-note {
      margin-top: 2rem;
      font-size: 0.75rem;
      color: #667781;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo-container">
      <svg viewBox="0 0 24 24">
        <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.92-9.91-9.92zM12.04 20.14c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31c-.82-1.31-1.26-2.83-1.26-4.38 0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.54-3.7 8.24-8.24 8.24z"/>
      </svg>
    </div>
    <h1>MasterWhats</h1>
    <p class="subtitle">Acesso restrito para visualização das conversas e documentos processuais.</p>

    ${errorMessage ? `<div class="error-alert">${errorMessage}</div>` : ''}

    <a href="/auth/google" class="btn-google">
      <svg viewBox="0 0 24 24">
        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
        <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
      </svg>
      Entrar com Google
    </a>

    <div class="footer-note">
      Autenticação federada via Google OAuth 2.0.<br>Tráfego restrito à infraestrutura de hospedagem e borda, sem telemetria ou rastreadores de terceiros.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Cria o roteador de autenticação.
 */
export function createAuthRouter(options = {}) {
  const router = express.Router();

  const clientId = options.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = options.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const configuredRedirectUri = options.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI;

  const allowedEmails = options.allowedEmails ?? (
    process.env.ALLOWED_EMAILS
      ? process.env.ALLOWED_EMAILS.split(',').map(s => s.trim()).filter(Boolean)
      : []
  );

  const allowedDomains = options.allowedDomains ?? (
    process.env.ALLOWED_DOMAINS
      ? process.env.ALLOWED_DOMAINS.split(',').map(s => s.trim()).filter(Boolean)
      : []
  );

  const exchangeCodeForTokens = options.exchangeCodeForTokens || (async (code, redirectUri) => {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Google token exchange falhou com status ${response.status}`);
    }

    return response.json();
  });

  const verifyIdToken = options.verifyIdToken || ((idToken, nonce) =>
    verifyGoogleIdToken(idToken, nonce, clientId));

  // Tela de login
  router.get('/login', (req, res) => {
    const error = req.query.error;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderLoginPage(error));
  });

  // Início do fluxo OAuth
  router.get('/google', (req, res) => {
    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const returnTo = sanitizeReturnTo(req.query.returnTo || req.session?.returnTo || '/');

    req.session.oauth = {
      state,
      nonce,
      returnTo,
    };

    const host = req.get('host');
    const protocol = req.protocol;
    const redirectUri = configuredRedirectUri || `${protocol}://${host}/auth/google/callback`;

    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleAuthUrl.searchParams.set('client_id', clientId || '');
    googleAuthUrl.searchParams.set('redirect_uri', redirectUri);
    googleAuthUrl.searchParams.set('response_type', 'code');
    googleAuthUrl.searchParams.set('scope', 'openid email profile');
    googleAuthUrl.searchParams.set('state', state);
    googleAuthUrl.searchParams.set('nonce', nonce);
    googleAuthUrl.searchParams.set('prompt', 'select_account');

    res.redirect(googleAuthUrl.toString());
  });

  // Callback do Google OAuth
  router.get('/google/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect('/auth/login?error=oauth_error');
    }

    const savedState = req.session?.oauth?.state;
    if (!state || !savedState || state !== savedState) {
      return res.redirect('/auth/login?error=invalid_state');
    }

    if (!code) {
      return res.redirect('/auth/login?error=oauth_error');
    }

    try {
      const host = req.get('host');
      const protocol = req.protocol;
      const redirectUri = configuredRedirectUri || `${protocol}://${host}/auth/google/callback`;

      const tokens = await exchangeCodeForTokens(code, redirectUri);
      const userInfo = await verifyIdToken(tokens.id_token, req.session.oauth.nonce);

      // Verificação estrita de e-mail verificado
      if (!userInfo.email_verified) {
        return res.redirect('/auth/login?error=unverified_email');
      }

      // Verificação da allowlist se configurada
      if (!isEmailAllowed(userInfo.email, allowedEmails, allowedDomains)) {
        return res.redirect('/auth/login?error=forbidden');
      }

      req.session.user = {
        sub: userInfo.sub,
      };

      const returnTo = sanitizeReturnTo(req.session.oauth?.returnTo || '/');
      delete req.session.oauth;
      delete req.session.returnTo;

      return res.redirect(returnTo);
    } catch (err) {
      console.error('[auth] Erro no callback Google:', err.message);
      return res.redirect('/auth/login?error=oauth_error');
    }
  });

  router.get('/logout', (req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).send('Method Not Allowed');
  });

  router.post('/logout', (req, res) => {
    const origin = req.get('origin');
    if (origin) {
      try {
        const configuredOrigin = new URL(options.baseUrl || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).origin;
        if (new URL(origin).origin !== configuredOrigin) return res.status(403).send('Forbidden');
      } catch {
        return res.status(403).send('Forbidden');
      }
    }

    req.session = null;
    res.redirect('/auth/login');
  });

  router.get('/me', (req, res) => {
    if (req.session?.user?.sub) {
      return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
  });

  return router;
}

/**
 * Middleware para exigir autenticação em rotas protegidas.
 */
export function requireAuth(req, res, next) {
  if (req.session?.user?.sub) {
    return next();
  }

  // Requisições assíncronas / API / dados JSON recebem 401
  const isApiOrData = req.path.startsWith('/data/') ||
    req.path.startsWith('/export/') ||
    req.headers.accept?.includes('application/json') ||
    req.xhr;

  if (isApiOrData) {
    return res.status(401).json({
      error: 'unauthorized',
      login_url: '/auth/login',
    });
  }

  // Requisições normais de navegação são redirecionadas para login
  if (req.method === 'GET') {
    if (req.session) {
      req.session.returnTo = req.originalUrl;
    }
  }

  return res.redirect('/auth/login');
}
