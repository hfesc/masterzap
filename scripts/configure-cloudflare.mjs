/**
 * Script de automação e validação da API v4 do Cloudflare para o MasterZap.
 * Gerencia a descoberta de zona (hfesc.dev), criação/atualização do registro CNAME proxied
 * apontando para o endpoint do Heroku, e garante SSL Full (Strict) e Always Use HTTPS.
 */

import fs from 'node:fs';
import path from 'node:path';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const ZONE_NAME = 'hfesc.dev';
const RECORD_NAME = 'masterzap.hfesc.dev';
const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SECRETS_DIR = path.join(ROOT_DIR, '.secrets');
const TOKEN_FILE = path.join(SECRETS_DIR, 'cloudflare-token');

function getApiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return process.env.CLOUDFLARE_API_TOKEN.trim();
  }
  if (process.env.CF_API_TOKEN) {
    return process.env.CF_API_TOKEN.trim();
  }
  if (fs.existsSync(TOKEN_FILE)) {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  }
  return null;
}

async function cfFetch(endpoint, token, options = {}) {
  const url = `${CLOUDFLARE_API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const body = await res.json();
  if (!res.ok || !body.success) {
    const err = new Error(`Cloudflare API Error [${res.status}] on ${endpoint}: ${JSON.stringify(body.errors || body)}`);
    err.cfErrors = body.errors;
    err.status = res.status;
    throw err;
  }
  return body.result;
}

export async function verifyToken(token) {
  const result = await cfFetch('/user/tokens/verify', token);
  return result;
}

export async function getZoneId(token, zoneName = ZONE_NAME) {
  const zones = await cfFetch(`/zones?name=${encodeURIComponent(zoneName)}&status=active`, token);
  if (!zones || zones.length === 0) {
    throw new Error(`Zona Cloudflare "${zoneName}" não encontrada ou sem acesso com este token.`);
  }
  return zones[0].id;
}

export async function getDnsRecord(token, zoneId, recordName = RECORD_NAME) {
  const records = await cfFetch(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(recordName)}&type=CNAME`, token);
  return records && records.length > 0 ? records[0] : null;
}

export async function upsertDnsRecord(token, zoneId, { name = RECORD_NAME, target, proxied = true }) {
  const existing = await getDnsRecord(token, zoneId, name);
  const payload = {
    type: 'CNAME',
    name,
    content: target,
    ttl: 1, // Automatic
    proxied,
    comment: 'MasterZap Heroku origin edge proxy',
  };

  if (existing) {
    if (existing.content === target && existing.proxied === proxied) {
      console.log(`[Cloudflare] Registro CNAME ${name} -> ${target} (proxied=${proxied}) já está atualizado.`);
      return existing;
    }
    console.log(`[Cloudflare] Atualizando CNAME ${name}: de ${existing.content} -> ${target}...`);
    return await cfFetch(`/zones/${zoneId}/dns_records/${existing.id}`, token, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  } else {
    console.log(`[Cloudflare] Criando registro CNAME ${name} -> ${target} (proxied=${proxied})...`);
    return await cfFetch(`/zones/${zoneId}/dns_records`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

export async function configureSslTls(token, zoneId) {
  console.log('[Cloudflare] Verificando e configurando SSL/TLS para strict...');
  const sslSetting = await cfFetch(`/zones/${zoneId}/settings/ssl`, token, {
    method: 'PATCH',
    body: JSON.stringify({ value: 'strict' }),
  });

  console.log('[Cloudflare] Configurando Always Use HTTPS...');
  const httpsSetting = await cfFetch(`/zones/${zoneId}/settings/always_use_https`, token, {
    method: 'PATCH',
    body: JSON.stringify({ value: 'on' }),
  });

  console.log('[Cloudflare] Configurando TLS Mínimo para 1.2...');
  const minTlsSetting = await cfFetch(`/zones/${zoneId}/settings/min_tls_version`, token, {
    method: 'PATCH',
    body: JSON.stringify({ value: '1.2' }),
  });

  return {
    ssl: sslSetting.value,
    alwaysUseHttps: httpsSetting.value,
    minTlsVersion: minTlsSetting.value,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isStatusOnly = args.includes('--status');
  const targetIndex = args.indexOf('--target');
  const dnsTarget = targetIndex !== -1 ? args[targetIndex + 1] : 'fluffy-mammal-ccut0q1tbjb79qhc7uyus09w.herokudns.com';

  const token = getApiToken();
  if (!token) {
    console.log('=== CONFIGURAÇÃO CLOUDFLARE: AGUARDANDO TOKEN ===');
    console.log('Nenhum Cloudflare API Token detectado.');
    console.log('Para executar a automação, defina CLOUDFLARE_API_TOKEN ou grave em .secrets/cloudflare-token');
    console.log('\nConfiguração necessária no Cloudflare Dashboard (ou via API):');
    console.log(`- Zona: ${ZONE_NAME}`);
    console.log(`- Tipo: CNAME`);
    console.log(`- Nome: masterzap`);
    console.log(`- Alvo (Target): ${dnsTarget}`);
    console.log(`- Proxy status: Proxied (Nuvem Laranja ativada)`);
    console.log(`- SSL/TLS: Full (Strict)`);
    console.log(`- Always Use HTTPS: On`);
    console.log(`- Minimum TLS Version: 1.2`);
    return;
  }

  console.log('[Cloudflare] Validando token...');
  const verifyResult = await verifyToken(token);
  console.log(`[Cloudflare] Token válido (Status: ${verifyResult.status})`);

  const zoneId = await getZoneId(token, ZONE_NAME);
  console.log(`[Cloudflare] Zona localizada: ${ZONE_NAME} (ID: ${zoneId})`);

  const existingRecord = await getDnsRecord(token, zoneId, RECORD_NAME);
  if (existingRecord) {
    console.log(`[Cloudflare] Registro CNAME atual: ${existingRecord.name} -> ${existingRecord.content} (proxied: ${existingRecord.proxied})`);
  } else {
    console.log(`[Cloudflare] Registro ${RECORD_NAME} ainda não existe.`);
  }

  if (isStatusOnly) {
    return;
  }

  const recordResult = await upsertDnsRecord(token, zoneId, {
    name: RECORD_NAME,
    target: dnsTarget,
    proxied: true,
  });

  console.log(`[Cloudflare] Registro CNAME configurado com sucesso: ${recordResult.name} -> ${recordResult.content} (proxied=${recordResult.proxied})`);

  const settingsResult = await configureSslTls(token, zoneId);
  console.log('[Cloudflare] Configurações de segurança aplicadas:', settingsResult);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error('Erro na configuração Cloudflare:', err.message);
    process.exit(1);
  });
}
