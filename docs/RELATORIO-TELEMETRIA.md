# Relatório de Auditoria de Telemetria e Vazamento de Dados

Data: 2026-09-05  
Branch: `chore/harden-and-heroku`  
Auditor: Claude Code (Harness de Hardening)  
Status: Concluído  

---

## 1. Tabela Consolidada de Achados

| # | Arquivo:Linha | Categoria | O que coleta | Para onde envia | Risco | Ação Proposta |
|---|---|---|---|---|:---:|---|
| 1 | `index.html:182` | Web Analytics | Page views, rotas acessadas, sessões, métricas de performance (Web Vitals) | Servidor de métricas da Vercel (`/_vercel/insights/script.js` -> `/_vercel/insights/event`) | **Alto** | **Remover**: eliminar a tag `<script defer src="/_vercel/insights/script.js"></script>` |
| 2 | `index.html:44-46` | Fontes Externas (CDN) | IP do usuário, User-Agent, cabeçalho Referer no handshake TLS e download | Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | **Alto** | **Substituir por local**: baixar arquivos WOFF2 das variantes do Roboto (300, 400, 500, 700), servir de `/assets/fonts/` e definir `@font-face` local |
| 3 | `index.html:148,149,171-176` | Vazamento de Referer em Links Externos | URL completa e caminho da página no cabeçalho HTTP `Referer` ao clicar em links de notícias (Wikipedia, UOL, G1, Poder360, CNN) | Servidores de terceiros (domínios externos de notícias) | **Médio** | **Remover vazamento**: adicionar `target="_blank" rel="noopener noreferrer"` em todos os links e incluir meta tag `<meta name="referrer" content="no-referrer">` |
| 4 | `index.html:178` | Vazamento de Referer em Links de Crédito | URL de navegação no cabeçalho HTTP `Referer` ao clicar nos links de LinkedIn e GitHub | LinkedIn e GitHub | **Médio** | **Remover vazamento**: atualizar `rel="noopener"` para `rel="noopener noreferrer"` |
| 5 | `src/lib/profile-content.js:452` | Vazamento de Referer em Links Dinâmicos | URL da página atual via cabeçalho `Referer` em links nos perfis de contatos | Destinos externos configurados no perfil | **Médio** | **Remover vazamento**: alterar template string para incluir `rel="noopener noreferrer"` |
| 6 | `scripts/lib/corpus.mjs:219` | Vazamento de Referer em Links Gerados | URL de origem em links gerados nos artefatos de texto | Destinos de links externos | **Médio** | **Remover vazamento**: atualizar gerador de HTML para emitir `rel="noopener noreferrer"` |
| 7 | `scripts/prerender.mjs:186,217` | Vazamento de Referer em Páginas Pré-renderizadas | URL de origem em links de fontes e documentos externos gerados pelo pré-renderizador | Repositório GitHub / fontes externas | **Médio** | **Remover vazamento**: atualizar gerador de HTML para emitir `rel="noopener noreferrer"` |
| 8 | `vercel.json:5-10` | Redirecionamento de Ativos para Terceiro | Requisições a `/data/source/(.*)` redirecionadas para GitHub Raw | GitHub (`raw.githubusercontent.com`) | **Médio** | **Remover/Substituir**: no servidor Express, servir localmente ou responder com bloqueio sem redirecionamento externo |
| 9 | `src/main.js:527`<br>`src/lib/data-store.js:63`<br>`src/lib/search.js:29` | Requisições de Rede em Tempo de Execução (`fetch`) | Apenas dados operacionais locais da aplicação (`/data/calls.json`, `/data/...`, `/search-index.json`) | Própria origem (`'self'`) | **Baixo** | **Manter com justificativa**: requisições estritamente locais para arquivos JSON estáticos essenciais para funcionamento do viewer |
| 10 | `src/lib/read-state.js:18,37,48` | Armazenamento no Cliente (`localStorage`) | Array serializado de IDs de conversas lidas pelo usuário (`masterwhats:read-conversations`) | Isolado no storage local do navegador (nunca transmitido à rede) | **Baixo** | **Manter com justificativa**: persistência de estado de UI puramente local, sem identificadores de tracking ou sincronização externa |
| 11 | `package.json` | Dependências NPM em Produção | Dependências de analytics, SDKs de rastreamento ou tracking libraries | Não encontrado (dependências de produção vazias `{}`) | **Baixo** | **Manter**: auditado e confirmado limpo |
| 12 | `src/`, `public/` | Service Workers / Push / Background Sync | Rastreamento em background, notificações ou sincronização de dados | Não encontrado | **Baixo** | **Manter**: auditado e confirmado ausente |
| 13 | `src/`, `index.html` | RUM / Rastreamento de Erros (Sentry, Datadog, LogRocket, Bugsnag, GA) | Rastreamento de sessões de usuário, erros e telemetria de produção | Não encontrado | **Baixo** | **Manter**: auditado e confirmado ausente |
| 14 | `vercel.json:30-58` | Content Security Policy (CSP) Ausente | Falta de restrição estrita de origens de script, estilo, imagem e conexão | Navegador vulnerável a carregar recursos externos caso haja injeção | **Médio** | **Remover risco**: implementar política estrita no servidor Express via Helmet (`default-src 'self'`, `connect-src 'self'`, etc.) |
| 15 | Ambiente / Scripts | Telemetria de Ferramentas de Build | Dados de compilação/uso em CLI de ferramentas terceiras | Não detectado, mas deve ser garantido preventivamente | **Baixo** | **Prevenção**: injetar `DO_NOT_TRACK=1` nas variáveis de ambiente do build, CI e runtime |

---

## 2. Comandos Executados e Evidências Concretas

### 2.1. Verificação de Scripts de Analytics (Vercel Insights)
- **Comando:** `rg -n "insights/script.js" index.html`
- **Saída:**
  ```text
  182:  <script defer src="/_vercel/insights/script.js"></script>
  ```
- **Conclusão:** Tag presente em `index.html:182`. Remediação obrigatória.

### 2.2. Verificação de Fontes Externas e CDNs
- **Comando:** `rg -n "fonts.googleapis|fonts.gstatic" index.html`
- **Saída:**
  ```text
  44:  <link rel="preconnect" href="https://fonts.googleapis.com">
  45:  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  46:  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
  ```
- **Conclusão:** Dependência externa ativa para `fonts.googleapis.com` e `fonts.gstatic.com`. Remediação obrigatória com auto-hospedagem das fontes.

### 2.3. Verificação de Links Externos e Atributos `rel`
- **Comando:** `rg -n "<a " index.html`
- **Saída:**
  ```text
  148:  ...de <a href="https://en.wikipedia.org/wiki/Daniel_Vorcaro">Daniel Vorcaro</a>...
  149:  ...no centro do <a href="https://pt.wikipedia.org/wiki/Esc%C3%A2ndalo_do_Banco_Master">...
  171:  <li><a href="https://www.poder360.com.br/poder-justica/mendonca-retira-sigilo-de-acao-sobre-vorcaro-e-moraes/">...
  178:  <p>Projeto feito por <a href="https://linkedin.com/in/rafaelbressan" target="_blank" rel="noopener">...
  ```
- **Comando:** `rg -n 'rel="noopener' src/ scripts/`
- **Saída:**
  ```text
  src/lib/profile-content.js:452:    return `<a href="${url}" target="_blank" rel="noopener">${linkText}</a>`;
  scripts/lib/corpus.mjs:219:    : mode === 'html' ? `<a href="${escapeHtml(href)}"${href.startsWith('http') ? ' rel="noopener"' : ''}>${escapeHtml(label)}</a>`
  scripts/prerender.mjs:186:  if (source.document) out.push(`<dt>Documento</dt><dd>${source.document_url ? `<a href="${escapeHtml(source.document_url)}" rel="noopener">...
  scripts/prerender.mjs:217:  return ['<h2>Fontes</h2><ul>', ...sources.map(u => `<li><a href="${escapeHtml(u)}" rel="noopener">${escapeHtml(u)}</a></li>`), '</ul>'];
  ```
- **Conclusão:** Múltiplos links externos sem `rel="noreferrer"` encontrados no HTML estático e em geradores JS.

### 2.4. Verificação de Chamadas de Rede em Tempo de Execução
- **Comando:** `rg -n "fetch\(|XMLHttpRequest|sendBeacon" src/`
- **Saída:**
  ```text
  src/main.js:527:    callsPromise ??= fetch('/data/calls.json').then(r => r.json()).then(d => d.calls);
  src/lib/data-store.js:63:    this._fetcher = fetcher || ((url) => fetch(url).then(r => {
  src/lib/search.js:29:  _loading = fetch(`${basePath}/${conversationId}/search-index.json`)
  ```
- **Conclusão:** 100% das chamadas de rede no cliente apontam para endpoints estáticos locais (`/data/`). Nenhuma requisição a servidores de terceiros.

### 2.5. Verificação de Mecanismos de Armazenamento Local
- **Comando:** `rg -n "localStorage|sessionStorage|indexedDB|document\.cookie" src/`
- **Saída:**
  ```text
  src/lib/read-state.js:18:    const raw = localStorage.getItem(STORAGE_KEY);
  src/lib/read-state.js:37:    localStorage.setItem(STORAGE_KEY, JSON.stringify([...readSet]));
  src/lib/read-state.js:48:    localStorage.removeItem(STORAGE_KEY);
  ```
- **Conclusão:** Apenas a chave `masterwhats:read-conversations` é manipulada em `localStorage` para manter o filtro de conversas lidas. Não há geração de IDs persistentes de visitante ou compartilhamento com terceiros.

### 2.6. Verificação de RUM, Error Tracking e SDKs Terceiros
- **Comando:** `rg -n -i "sentry|logrocket|datadog|bugsnag|google-analytics|gtag" src/ index.html`
- **Saída:** `Não encontrado` (Exit code 1)
- **Conclusão:** Ausência total de ferramentas comerciais de monitoramento e rastreamento de erros.

### 2.7. Verificação de Service Workers e Background APIs
- **Comando:** `rg -n "serviceWorker|PushManager|SyncManager" src/ public/`
- **Saída:** `Não encontrado` (Exit code 1)
- **Conclusão:** Não existem Service Workers, Web Push ou Background Sync instalados.

### 2.8. Verificação de Cabeçalhos e Redirecionamentos em `vercel.json`
- **Comando:** `cat vercel.json`
- **Saída:** Cabeçalho `Referrer-Policy: strict-origin-when-cross-origin` e redirecionamento de `/data/source/(.*)` para `raw.githubusercontent.com`.
- **Conclusão:** Ausência de `Content-Security-Policy`. Redirecionamento para GitHub deve ser descontinuado no servidor final.

---

## 3. Plano de Remediação para a Fase 2

1. **Eliminar Analytics:** Remover a linha 182 de `index.html`.
2. **Auto-hospedar Fontes Roboto:**
   - Baixar e validar os arquivos binários WOFF2 para Roboto 300, 400, 500 e 700.
   - Salvar em `public/assets/fonts/`.
   - Adicionar regras `@font-face` em `src/styles/fonts.css` apontando para `/assets/fonts/`.
   - Remover os links de preconnect e stylesheet de `fonts.googleapis.com` em `index.html`.
3. **Hardening de Referrer e Links:**
   - Adicionar `<meta name="referrer" content="no-referrer">` no `<head>` de `index.html`.
   - Atualizar todos os links externos de `index.html`, `src/lib/profile-content.js`, `scripts/lib/corpus.mjs` e `scripts/prerender.mjs` para `rel="noopener noreferrer"`.
4. **Configuração de Variáveis de Ambiente Anti-Telemetria:**
   - Adicionar `DO_NOT_TRACK=1` no ambiente de compilação e execução.
5. **Automação de Teste de Guarda (Zero Telemetry Guard):**
   - Criar `tests/unit/no-telemetry.test.js` para garantir que `index.html`, arquivos de script e dist não contenham referências a domínios externos de fontes, analytics ou scripts sem `noreferrer`.
   - Criar teste Playwright (`tests/e2e/telemetry.spec.js`) com `page.on('request')` interceptando qualquer tentativa de requisição de rede para fora de `localhost`/origem local.
