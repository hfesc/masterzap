/**
 * Script de medição de capacidade do servidor Express para calibração de dyno Heroku.
 * Mede startup time, RSS ocioso, latências sob concorrência (1, 5, 10, 25 clientes),
 * pico de memória e validação de streaming de arquivos grandes (17MB).
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createApp } from '../server/index.js';

const PORT = 3456;
const ROOT = path.resolve(import.meta.dirname, '..');
const DIST_PATH = path.join(ROOT, 'dist');

function getMemoryUsageMB() {
  const mem = process.memoryUsage();
  return {
    rss: (mem.rss / 1024 / 1024).toFixed(2),
    heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2),
    heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2),
  };
}

async function fetchUrl(urlPath, options = {}) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${PORT}${urlPath}`,
      {
        headers: options.headers || {},
      },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
        });
        res.on('end', () => {
          const duration = performance.now() - start;
          resolve({
            statusCode: res.statusCode,
            bytes,
            duration,
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Timeout'));
    });
  });
}

async function runConcurrencyTest(endpoint, concurrency, totalRequests) {
  const latencies = [];
  let errors = 0;
  let completed = 0;
  let totalBytes = 0;

  const startTime = performance.now();

  async function worker() {
    while (completed < totalRequests) {
      completed++;
      try {
        const res = await fetchUrl(endpoint);
        if (res.statusCode >= 400) {
          errors++;
        }
        latencies.push(res.duration);
        totalBytes += res.bytes;
      } catch (err) {
        errors++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const totalTime = (performance.now() - startTime) / 1000;
  latencies.sort((a, b) => a - b);

  const median = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const throughput = (totalRequests / totalTime).toFixed(1);

  return {
    concurrency,
    totalRequests,
    errors,
    median: median.toFixed(2),
    p95: p95.toFixed(2),
    throughput,
    totalBytesMB: (totalBytes / 1024 / 1024).toFixed(2),
  };
}

async function main() {
  console.log('=== BENCHMARK DE CAPACIDADE DO SERVIDOR EXPRESS ===\n');

  const startTime = performance.now();
  const app = createApp({
    distPath: DIST_PATH,
    sessionSecret: 'test-secret-at-least-32-chars-long-benchmark',
    testAuth: {
      email: 'bench@hfesc.dev',
      name: 'Benchmark Tester',
      email_verified: true,
    },
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  const bootDuration = (performance.now() - startTime).toFixed(2);
  console.log(`Tempo de inicialização: ${bootDuration} ms na porta ${PORT}`);

  // Warm-up inicial
  await fetchUrl('/healthz');
  await fetchUrl('/auth/login');
  await fetchUrl('/data/conversations.json');

  const idleMem = getMemoryUsageMB();
  console.log(`Memória ociosa pós-warmup: RSS = ${idleMem.rss} MB, Heap = ${idleMem.heapUsed} MB\n`);

  const endpoints = [
    { name: 'Healthcheck (/healthz)', path: '/healthz' },
    { name: 'App Shell (/auth/login)', path: '/auth/login' },
    { name: 'Lista de Conversas (/data/conversations.json)', path: '/data/conversations.json' },
    { name: 'Chunk Diário Lazy (/data/martha-graeff/2024-02-10.json)', path: '/data/martha-graeff/2024-02-10.json' },
    { name: 'Página Pré-renderizada (/chat/martha-graeff/)', path: '/chat/martha-graeff/' },
    { name: 'Índice de Busca 5.2MB (/data/martha-graeff/search-index.json)', path: '/data/martha-graeff/search-index.json' },
  ];

  const reportData = [];
  let peakRss = parseFloat(idleMem.rss);

  for (const ep of endpoints) {
    console.log(`\n--- Testando ${ep.name} ---`);
    for (const c of [1, 5, 10, 25]) {
      const totalReq = c * 5; // número de requisições proporcional à concorrência
      const res = await runConcurrencyTest(ep.path, c, totalReq);
      const mem = getMemoryUsageMB();
      if (parseFloat(mem.rss) > peakRss) {
        peakRss = parseFloat(mem.rss);
      }
      console.log(
        `  Concorrência ${c.toString().padStart(2)}: ${totalReq} reqs | Mediana: ${res.median}ms | p95: ${res.p95}ms | Throughput: ${res.throughput} req/s | Erros: ${res.errors} | RSS: ${mem.rss}MB`
      );
      reportData.push({
        endpoint: ep.name,
        path: ep.path,
        concurrency: c,
        requests: totalReq,
        medianMs: res.median,
        p95Ms: res.p95,
        rps: res.throughput,
        errors: res.errors,
        rssMB: mem.rss,
      });
    }
  }

  // Teste de streaming de arquivo grande (17MB)
  console.log('\n--- Teste de Streaming de Arquivo Grande (17MB) ---');
  const streamFile = '/export/masterwhats-martha-graeff.json';
  const memBeforeStream = getMemoryUsageMB();
  console.log(`Memória antes de stream: RSS = ${memBeforeStream.rss} MB`);

  const streamStart = performance.now();
  const streamRes = await fetchUrl(streamFile);
  const streamDuration = (performance.now() - streamStart).toFixed(2);
  const memAfterStream = getMemoryUsageMB();

  if (parseFloat(memAfterStream.rss) > peakRss) {
    peakRss = parseFloat(memAfterStream.rss);
  }

  console.log(`Download stream concluído: ${streamRes.bytes} bytes em ${streamDuration} ms (HTTP ${streamRes.statusCode})`);
  console.log(`Memória pós-stream: RSS = ${memAfterStream.rss} MB (Variação: +${(parseFloat(memAfterStream.rss) - parseFloat(memBeforeStream.rss)).toFixed(2)} MB)`);

  await new Promise((resolve) => server.close(resolve));

  console.log(`\n=== RESUMO FINAL ===`);
  console.log(`Pico de RSS observado: ${peakRss.toFixed(2)} MB`);
  console.log(`Limite do Dyno Basic: 512 MB`);
  console.log(`Margem livre no dyno: ${(512 - peakRss).toFixed(2)} MB (${(((512 - peakRss) / 512) * 100).toFixed(1)}% de folga)`);

  return {
    bootDuration,
    idleMem,
    peakRss: peakRss.toFixed(2),
    streamStats: {
      bytes: streamRes.bytes,
      durationMs: streamDuration,
      memBefore: memBeforeStream.rss,
      memAfter: memAfterStream.rss,
    },
    reportData,
  };
}

main().then((data) => {
  fs.writeFileSync(path.join(ROOT, 'capacity-report.json'), JSON.stringify(data, null, 2));
}).catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
