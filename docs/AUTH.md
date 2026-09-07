# Autenticação Google OAuth 2.0 / OpenID Connect

Este documento descreve a arquitetura de autenticação e proteção de acesso implementada no **MasterWhats** para execução em produção.

---

## 1. Visão Geral

O MasterWhats foi projetado com isolamento estrito de dados e política de **Zero Telemetria**. Para proteger todo o acervo documental e mensagens, o servidor Express atua como proxy reverso autenticado que exige login via conta Google antes de liberar o acesso a qualquer página, rota de chat ou arquivo JSON.

```
                  ┌──────────────────────┐
                  │   Cloudflare Edge    │
                  │ (WAF / Bot Defense)  │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    Heroku Dyno       │
                  │   (Express Server)   │
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   Rota Pública (/healthz, /auth)    Rotas Protegidas (dist/*, /data/*)
   - /healthz (Healthcheck)          - Requer sessão ativa com e-mail verificado
   - /auth/login (UI WhatsApp style) - Redireciona para /auth/login se deslogado
   - /auth/google (Início OAuth)     - Retorna 401 JSON para chamadas de dados
   - /auth/google/callback (Validação)
   - /auth/logout (Encerra sessão)
```

---

## 2. Garantias de Segurança

1. **Proteção Anti-CSRF e Anti-Replay:**
   - Para cada requisição em `/auth/google`, são gerados tokens criptográficos aleatórios de 256 bits (`state` e `nonce`).
   - O `state` é validado estritamente no callback para prevenir ataques de login forçado e falsificação de solicitação.

2. **Verificação Obrigatória de E-mail (`email_verified: true`):**
   - O endpoint de callback valida o atributo `email_verified` retornado pelo Google OIDC.
   - Contas com e-mails não verificados são terminantemente rejeitadas (`error=unverified_email`).

3. **Prevenção contra Open Redirect:**
   - O parâmetro `returnTo` passa pela função `sanitizeReturnTo()`, aceitando apenas caminhos relativos internos iniciados por `/` e bloqueando protocolos de esquema relativo (como `//malicious.com`).

4. **Sessão Assinada e Segura via Cookies:**
   - Cookies assinados com chave simétrica (`cookie-session`).
   - Flag `httpOnly: true` (inacessível para scripts cliente).
   - Flag `secure: true` em ambiente de produção (força transmissão unicamente via HTTPS).
   - Flag `sameSite: 'lax'` (mitigação contra CSRF inter-sites).

5. **Zero Telemetria e CSP Estrito:**
   - A tela de login é 100% self-hosted, sem carregamento de fontes externas, scripts ou analytics.
   - Cabeçalhos de segurança estritos via Helmet: `default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'` e `Referrer-Policy: no-referrer`.

---

## 3. Variáveis de Ambiente

| Variável | Obrigatória? | Descrição | Exemplo |
| :--- | :---: | :--- | :--- |
| `SESSION_SECRET` | **Sim** | Chave secreta de no mínimo 32 caracteres usada para assinar os cookies de sessão. | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | **Sim** | Client ID OAuth 2.0 gerado no Google Cloud Console. | `xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | **Sim** | Client Secret correspondente ao Client ID. | `GOCSPX-xxxxxxxxxxxx` |
| `GOOGLE_REDIRECT_URI` | Opcional | URI de callback OAuth. Se omitido, é derivado do Host HTTP recebido. | `https://masterzap.hfesc.dev/auth/google/callback` |
| `ALLOWED_EMAILS` | Opcional | Lista separada por vírgula de e-mails autorizados. Se omitida/vazia, permite qualquer conta Google verificada. | `admin@hfesc.dev,colab@empresa.com` |
| `ALLOWED_DOMAINS` | Opcional | Lista separada por vírgula de domínios autorizados. Se omitida/vazia, permite qualquer domínio. | `hfesc.dev,empresa.com.br` |
| `NODE_ENV` | Recomendado | Define modo de produção para ativar cookies HTTPS seguros. | `production` |
| `PORT` | Automática | Porta HTTP disponibilizada pelo Heroku (padrão: 3000 se local). | `3000` |

---

## 4. Passo a Passo: Configuração no Google Cloud Console

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Selecione o projeto dedicado ou crie um novo.
3. Navegue até **APIs e Serviços** > **Tela de permissão OAuth** (OAuth consent screen):
   - Tipo de usuário: **Externo** (ou Interno, se você usa Google Workspace e quer restringir ao seu domínio).
   - Nome do aplicativo: `MasterWhats`
   - E-mail de suporte do usuário: seu e-mail de contato.
   - Escopos solicitados: `openid`, `email`, `profile`.
4. Navegue até **Credenciais** > **Criar credenciais** > **ID do cliente OAuth**:
   - Tipo de aplicativo: **Aplicativo da Web**
   - Nome: `MasterWhats Web Client`
   - **Origens JavaScript autorizadas**:
     - `https://masterzap.hfesc.dev`
     - `http://localhost:3000` (para desenvolvimento local)
   - **URIs de redirecionamento autorizados**:
     - `https://masterzap.hfesc.dev/auth/google/callback`
     - `http://localhost:3000/auth/google/callback` (para testes locais)
5. Copie o **ID do cliente** e a **Chave secreta do cliente** gerados para configurar nas variáveis do Heroku e GitHub Secrets.

---

## 5. Execução e Testes

Para rodar os testes unitários do módulo de autenticação:

```bash
npm run test tests/unit/server-auth.test.js
```

Para iniciar o servidor localmente com autenticação:

```bash
export SESSION_SECRET="chave-secreta-de-teste-com-mais-de-trinta-e-dois-caracteres"
export GOOGLE_CLIENT_ID="seu-client-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="seu-client-secret"
npm start
```
