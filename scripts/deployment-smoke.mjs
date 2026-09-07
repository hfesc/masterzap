/**
 * Script de verificação de smoke de deployment para o MasterZap.
 *
 * Valida:
 * 1. Endpoint /healthz responde HTTP 200 com status 'ok'
 * 2. Raiz desautenticada redireciona para login e inicia fluxo OAuth sem erros 5xx
 * 3. Ausência de headers de telemetria proibidos (nel, report-to, reporting-endpoints) em todas as respostas de borda
 */

export const FORBIDDEN_EDGE_HEADERS = [
  'nel',
  'report-to',
  'reporting-endpoints',
];

/**
 * Valida se algum header proibido de telemetria ou reporting foi injetado.
 */
export function verifyNoTelemetryHeaders(headers, url) {
  for (const forbidden of FORBIDDEN_EDGE_HEADERS) {
    if (headers.has(forbidden)) {
      throw new Error(`Header de telemetria proibido detectado: ${forbidden} em ${url}`);
    }
  }
}

/**
 * Verifica o endpoint /healthz da aplicação.
 */
export async function verifyHealthz(targetUrl, { fetch = globalThis.fetch } = {}) {
  const url = `${targetUrl.replace(/\/+$/, '')}/healthz`;
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
  });

  verifyNoTelemetryHeaders(res.headers, url);

  if (res.status !== 200) {
    throw new Error(`/healthz retornou HTTP ${res.status}`);
  }

  const body = await res.json();
  if (!body || body.status !== 'ok') {
    throw new Error(`/healthz payload inválido: ${JSON.stringify(body)}`);
  }

  return {
    status: res.status,
    body,
  };
}

/**
 * Verifica o fluxo de redirecionamento de autenticação a partir da raiz.
 */
export async function verifyAuthRedirect(targetUrl, { fetch = globalThis.fetch } = {}) {
  const baseUrl = targetUrl.replace(/\/+$/, '');
  const rootUrl = `${baseUrl}/`;

  const rootRes = await fetch(rootUrl, {
    method: 'GET',
    redirect: 'manual',
  });

  verifyNoTelemetryHeaders(rootRes.headers, rootUrl);

  if (rootRes.status >= 500) {
    throw new Error(`HTTP ${rootRes.status} ao acessar rota raiz ${rootUrl}`);
  }

  const rootLocation = rootRes.headers.get('location') || '';

  // Se já redirecionou diretamente para o Google OAuth
  if (rootLocation.includes('accounts.google.com')) {
    return {
      success: true,
      finalOAuthUrl: rootLocation,
    };
  }

  // Se redirecionou para tela de login (/auth/login)
  const loginPath = rootLocation.startsWith('http') ? rootLocation : `${baseUrl}${rootLocation}`;
  const loginRes = await fetch(loginPath, {
    method: 'GET',
    redirect: 'manual',
  });

  verifyNoTelemetryHeaders(loginRes.headers, loginPath);

  if (loginRes.status >= 500) {
    throw new Error(`HTTP ${loginRes.status} ao acessar rota de login ${loginPath}`);
  }

  // Verifica rota de início do Google OAuth (/auth/google)
  const googleAuthInitUrl = `${baseUrl}/auth/google`;
  const googleRes = await fetch(googleAuthInitUrl, {
    method: 'GET',
    redirect: 'manual',
  });

  verifyNoTelemetryHeaders(googleRes.headers, googleAuthInitUrl);

  if (googleRes.status >= 500) {
    throw new Error(`HTTP ${googleRes.status} ao iniciar OAuth em ${googleAuthInitUrl}`);
  }

  const googleLocation = googleRes.headers.get('location') || '';
  if (!googleLocation.includes('accounts.google.com')) {
    throw new Error(`Esperado redirecionamento para accounts.google.com, recebido: ${googleLocation}`);
  }

  return {
    success: true,
    finalOAuthUrl: googleLocation,
  };
}

/**
 * Executa todas as verificações de smoke para o target especificado.
 */
export async function runDeploymentSmoke(targetUrl, { fetch = globalThis.fetch, logger = console } = {}) {
  const normalizedUrl = targetUrl.replace(/\/+$/, '');
  logger.log(`[deployment-smoke] Iniciando smoke test em: ${normalizedUrl}`);

  logger.log(`[deployment-smoke] 1. Verificando /healthz...`);
  const healthz = await verifyHealthz(normalizedUrl, { fetch });
  logger.log(`[deployment-smoke] ✓ /healthz respondendo OK (200)`);

  logger.log(`[deployment-smoke] 2. Verificando proteção e fluxo de redirecionamento para login/OAuth...`);
  const authRedirect = await verifyAuthRedirect(normalizedUrl, { fetch });
  logger.log(`[deployment-smoke] ✓ Redirecionamento OAuth verificado com sucesso`);

  logger.log(`[deployment-smoke] ✓ Todas as verificações e validações de cabeçalhos de borda passaram!`);
  return {
    ok: true,
    checks: {
      healthz,
      authRedirect,
    },
  };
}

async function main() {
  const targetUrl = process.argv[2] || process.env.APP_URL;

  if (!targetUrl) {
    console.error('Uso: node scripts/deployment-smoke.mjs <target_url>');
    console.error('Ou defina a variável de ambiente APP_URL.');
    process.exit(1);
  }

  try {
    await runDeploymentSmoke(targetUrl);
    process.exit(0);
  } catch (err) {
    console.error('[deployment-smoke] ✗ Falha na verificação de smoke de deployment:');
    console.error(err.message);
    process.exit(1);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
