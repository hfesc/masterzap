/**
 * Servidor Express para o MasterWhats em produção (Heroku).
 *
 * - Proteção com Helmet (CSP estrito, no-referrer, frame-ancestors none)
 * - Compressão gzip/brotli
 * - Sessão assinada via cookie-session (compatível com dyno simples sem Redis)
 * - Rota /healthz sem autenticação para monitoramento e healthchecks
 * - Autenticação Google OAuth 2.0 em /auth
 * - Proteção de todo o acervo estático e dados JSON atrás de requireAuth
 * - Suporte a rotas pré-renderizadas em dist/chat/<id>/ e SPA fallback
 */

import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieSession from 'cookie-session';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAuthRouter, requireAuth } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

export function createApp(options = {}) {
  const app = express();

  // Heroku e Cloudflare rodam atrás de proxies reversos
  app.set('trust proxy', 1);

  // Cabeçalhos de segurança estritos via Helmet
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://accounts.google.com'],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: {
      policy: 'no-referrer',
    },
  }));

  // Compressão de respostas HTTP
  app.use(compression());

  // Cookies de sessão assinados
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || 'masterzap-default-dev-secret-at-least-32-chars';
  app.use(cookieSession({
    name: 'masterzap_session',
    keys: [sessionSecret],
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  }));

  // Rota de Health Check desprotegida para Heroku e status monitoring
  app.get('/healthz', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Rotas de autenticação Google OAuth
  const authRouter = createAuthRouter(options);
  app.use('/auth', authRouter);

  // Middleware de teste exclusivo para medição e benchmarks (bloqueado em produção)
  if (process.env.NODE_ENV !== 'production' && options.testAuth) {
    app.use((req, res, next) => {
      if (req.session) {
        req.session.user = options.testAuth;
      }
      next();
    });
  }

  // Todo o restante do acervo exige login
  app.use(requireAuth);

  // Servir arquivos estáticos do diretório dist/
  const distPath = options.distPath || path.join(ROOT, 'dist');
  app.use(express.static(distPath, {
    maxAge: '1h',
  }));

  // Roteamento para páginas pré-renderizadas e fallback para SPA
  app.use((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).send('Method Not Allowed');
    }

    const cleanPath = req.path.replace(/^\/|\/$/g, '');
    const prerenderPath = path.join(distPath, cleanPath, 'index.html');

    if (cleanPath && fs.existsSync(prerenderPath)) {
      return res.sendFile(prerenderPath);
    }

    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }

    return res.status(404).send('Not Found');
  });

  return app;
}

// Inicia o servidor se executado diretamente
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[masterzap] Servidor iniciado na porta ${PORT}`);
  });
}
