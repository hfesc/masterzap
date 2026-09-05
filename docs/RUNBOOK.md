# Runbook Operacional: MasterZap (Heroku + Cloudflare + Google OAuth)

Este documento descreve os procedimentos de implantação, operação, monitoramento, segurança e recuperação de desastres para a aplicação `masterzap-hfesc`, hospedada no Heroku e protegida pelo Cloudflare e Google OAuth 2.0.

---

## 1. Visão Geral da Arquitetura

```
  [ Cliente / Navegador ]
             │ HTTPS (TLS 1.2+, HSTS, Bot Fight Mode)
             ▼
  [ Cloudflare Edge Proxy ] ─── (masterzap.hfesc.dev)
             │ CNAME: fluffy-mammal-ccut0q1tbjb79qhc7uyus09w.herokudns.com
             │ SSL/TLS: Full (Strict)
             ▼
  [ Heroku Basic Dyno ] ────── (masterzap-hfesc / us region)
             │
      [ Node.js 22.x / Express 5 ]
             ├── Middleware Helmet (HSTS, No-Referrer, CSP Zero-Telemetry)
             ├── Middleware Cookie-Session (HttpOnly, Secure, SameSite: Lax)
             ├── Google OAuth 2.0 (OpenID Connect + email_verified)
             ├── Streaming Estático Otimizado (Cache-Control: public, max-age=31536000, immutable)
             └── /healthz (Endpoint de liveness e métricas básicas)
```

### Principais Características e Hardening
- **Zero-Telemetria:** Fontes Roboto auto-hospedadas em WOFF2 (`public/fonts/`), metatags `referrer: no-referrer`, Content Security Policy restritiva sem CDNs externos de analítica ou rastreamento.
- **Headroom de Memória:** O servidor Express 5 realiza streaming dos chunks e exportações JSON (~17.6 MB) via `res.sendFile`, consumindo ~165 MB RSS sob 25 conexões simultâneas (margem de 67.8% dentro do limite de 512 MB do dyno Basic).
- **Isolamento de Segredos:** Zero credenciais comitadas no Git; escaneamento contínuo com Gitleaks (`.gitleaks.toml`).

---

## 2. Configuração de Domínio e TLS (Cloudflare)

O domínio `masterzap.hfesc.dev` é gerenciado no Cloudflare e encaminhado para o Heroku DNS Target:

1. **Registro DNS:**
   - **Tipo:** `CNAME`
   - **Nome:** `masterzap` (ou `masterzap.hfesc.dev`)
   - **Destino:** `fluffy-mammal-ccut0q1tbjb79qhc7uyus09w.herokudns.com`
   - **Proxy Status:** `Proxied` (Nuvem laranja ativada para proteção WAF e mitigação DDoS)

2. **Configurações de SSL/TLS (Cloudflare Dashboard):**
   - **Encryption Mode:** `Full (Strict)` (valida o certificado ACM do Heroku)
   - **Always Use HTTPS:** `Enabled`
   - **Minimum TLS Version:** `TLS 1.2`
   - **Opportunistic Encryption:** `Enabled`
   - **TLS 1.3:** `Enabled`

---

## 3. Autenticação Google OAuth 2.0 (GCP Console)

O acesso à aplicação requer login com uma conta Google com `email_verified: true`.

### Passo a Passo no Google Cloud Console
1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) no projeto corporativo.
2. Vá em **APIs & Services > OAuth consent screen**:
   - **User Type:** External
   - **App Name:** `MasterZap Archive`
   - **User support email:** seu e-mail de suporte
   - **Scopes:** `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`
3. Vá em **APIs & Services > Credentials**:
   - Clique em **Create Credentials > OAuth client ID**
   - **Application type:** Web application
   - **Name:** `MasterZap Web Client`
   - **Authorized JavaScript origins:**
     - `https://masterzap.hfesc.dev`
   - **Authorized redirect URIs:**
     - `https://masterzap.hfesc.dev/auth/google/callback`
4. Copie o **Client ID** e o **Client Secret** gerados.

---

## 4. Variáveis de Ambiente no Heroku

Para configurar as variáveis no dyno Heroku via terminal:

```bash
# Gere uma chave forte para encriptação da sessão de cookies
SESSION_SECRET=$(openssl rand -hex 32)

# Configure as variáveis essenciais
heroku config:set \
  NODE_ENV=production \
  BASE_URL="https://masterzap.hfesc.dev" \
  SESSION_SECRET="$SESSION_SECRET" \
  GOOGLE_CLIENT_ID="<SEU_GOOGLE_CLIENT_ID>.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="<SEU_GOOGLE_CLIENT_SECRET>" \
  -a masterzap-hfesc
```

### Variáveis Opcionais de Controle de Acesso
Por padrão, **qualquer conta Google verificada** tem permissão de acesso. Caso seja necessário restringir para determinados e-mails ou domínios corporativos:

```bash
# Exemplo: restringir para domínios específicos
heroku config:set ALLOWED_DOMAINS="hfesc.dev,empresa.com" -a masterzap-hfesc

# Exemplo: restringir para e-mails específicos
heroku config:set ALLOWED_EMAILS="admin@hfesc.dev,auditoria@hfesc.dev" -a masterzap-hfesc
```

---

## 5. Configuração dos Segredos no GitHub Actions

Para habilitar o pipeline de CI/CD automatizado, configure os seguintes segredos em **Settings > Secrets and variables > Actions** no repositório GitHub:

| Nome do Segredo | Descrição | Exemplo / Origem |
|---|---|---|
| `HEROKU_API_KEY` | Chave de API da conta Heroku com acesso ao app | Gerada em `Account Settings > API Key` no Heroku |
| `HEROKU_APP_NAME` | Nome exato da aplicação Heroku | `masterzap-hfesc` |
| `APP_URL` | URL canônica de produção para os smoke tests | `https://masterzap.hfesc.dev` |

---

## 6. Pipelines de CI/CD e Portões de Qualidade

### 6.1. Pipeline de CI (`.github/workflows/ci.yml`)
Disparado a cada `push` nas branches `main` e `chore/harden-and-heroku` e em `pull_request` para `main`:
1. **Lint & Security Audit (`lint-and-audit`):**
   - Executa `npm run lint`.
   - Executa `npm audit --audit-level=high`.
   - Executa varredura de segredos com `gitleaks-action` (usando `.gitleaks.toml`).
2. **Unit Tests & Coverage Gate (`unit`):**
   - Executa Vitest com enforcement estrito de cobertura em `src/lib/**/*.js`:
     - Lines: ≥ 80%
     - Statements: ≥ 80%
     - Branches: ≥ 70%
     - Functions: ≥ 75%
3. **Playwright E2E Tests (`e2e`):**
   - Executa suíte ponta a ponta nas resoluções desktop e mobile.
4. **Zero-Telemetry Guard (`telemetry-guard`):**
   - Executa `npm run test:telemetry` garantindo bloqueio total de chamadas de terceiros e integridade da política `no-referrer`.
5. **Stryker Mutation Testing Gate (`mutation`):**
   - Roda testes de mutação com `@stryker-mutator/vitest-runner`.
   - Threshold `break: 60` (falha o build se o mutation score cair abaixo de 60%).

### 6.2. Pipeline de Deploy (`.github/workflows/deploy.yml`)
Disparado automaticamente quando o workflow `CI` é concluído com sucesso na branch `main`:
1. Instala a CLI do Heroku e autentica com `HEROKU_API_KEY`.
2. Captura a versão atual da release (`PREV_RELEASE`).
3. Envia o código aprovado via `git push heroku $GITHUB_SHA:refs/heads/main`.
4. Aguarda o provisionamento dos dynos (15s).
5. **Smoke Test:**
   - Efetua requisição a `https://masterzap.hfesc.dev/healthz`, validando HTTP 200 e payload `{"status":"ok"}`.
   - Efetua requisição à raiz `/`, validando o redirecionamento 302 para o fluxo do Google OAuth.
6. **Rollback Automático:**
   - Em caso de falha no build Heroku ou no smoke test, o workflow dispara automaticamente:
     ```bash
     heroku rollback v$PREV_RELEASE -a masterzap-hfesc
     ```

---

## 7. Procedimentos Operacionais e Comandos de Emergência

### 7.1. Visualização de Logs em Tempo Real
```bash
heroku logs --tail -a masterzap-hfesc
```

### 7.2. Verificação de Status dos Dynos
```bash
heroku ps -a masterzap-hfesc
```

### 7.3. Reinicialização de Emergência
```bash
heroku ps:restart -a masterzap-hfesc
```

### 7.4. Rollback Manual para Versão Específica
Se um problema for detectado em produção após o deploy:
```bash
# 1. Listar releases anteriores
heroku releases -a masterzap-hfesc

# 2. Reverter para uma release específica (ex: v14)
heroku rollback v14 -a masterzap-hfesc
```

### 7.5. Redimensionamento de Recursos (Dyno Scaling)
O dyno padrão é `basic` (suficiente para o tráfego esperado e memória de 512 MB). Caso haja pico de tráfego:
```bash
# Escalar para dyno Standard-1X (métricas detalhadas e sem sleeping)
heroku ps:scale web=standard-1x -a masterzap-hfesc

# Retornar para dyno Basic
heroku ps:scale web=basic -a masterzap-hfesc
```

---

## 8. Verificação de Saúde Local (Desenvolvedores)

Antes de abrir um Pull Request para a branch `main`, execute a validação local completa:

```bash
# 1. Regenerar corpus e verificar build de produção
npm run build

# 2. Executar suíte de testes unitários com cobertura
npm run test:coverage

# 3. Executar testes de telemetria zero
npm run test:telemetry

# 4. Executar testes ponta a ponta
npm run test:e2e

# 5. Executar lint e verificação de segredos
npm run lint
.tools/bin/gitleaks protect --config=.gitleaks.toml --staged --verbose
```
