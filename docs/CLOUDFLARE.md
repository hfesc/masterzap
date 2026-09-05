# Configuração de Edge Proxy Cloudflare e TLS Estrito

Este documento descreve a arquitetura de proteção de borda (edge proxy) com **Cloudflare** na frente do dyno Heroku do **MasterZap** (`masterzap.hfesc.dev`), garantindo criptografia ponta a ponta, mitigação de ataques/bots e ocultação do endereço de origem.

---

## 1. Topologia da Infraestrutura

```
[ Usuário / Navegador ]
         │
         │ (HTTPS / TLS 1.3 obrigatório)
         ▼
[ Cloudflare Edge Proxy (Nuvem Laranja) ]
  • Domínio: masterzap.hfesc.dev
  • Proteções: WAF, Bot Fight Mode, DDoS Mitigation
  • SSL/TLS: Full (Strict)
  • Headers: Adiciona CF-Ray, remove referrers inseguros
         │
         │ (HTTPS / TLS Estrito autenticado)
         ▼
[ Heroku Dyno Origem (masterzap-hfesc) ]
  • Target CNAME: fluffy-mammal-ccut0q1tbjb79qhc7uyus09w.herokudns.com
  • Servidor: Express 5 + Node 22
  • Autenticação: Google OAuth 2.0 (OpenID Connect)
```

---

## 2. Parâmetros DNS e Proxy (Cloudflare v4 API)

| Parâmetro | Valor Configurado | Justificativa |
|---|---|---|
| **Zona** | `hfesc.dev` | Zona raiz administrada no Cloudflare |
| **Tipo de Registro** | `CNAME` | Apontamento canônico para o Heroku Router |
| **Nome (Host)** | `masterzap` (`masterzap.hfesc.dev`) | Subdomínio dedicado do acervo |
| **Conteúdo (Target)** | `fluffy-mammal-ccut0q1tbjb79qhc7uyus09w.herokudns.com` | Target gerado por `heroku domains:add masterzap.hfesc.dev -a masterzap-hfesc` |
| **Proxy Status** | `true` (Nuvem Laranja) | Oculta a infraestrutura Heroku e aplica WAF e cache de borda |
| **TTL** | `1` (Automático) | Gerenciado pela rede de distribuição Cloudflare |

---

## 3. Diretivas de Criptografia e Segurança SSL/TLS

As configurações de zona no Cloudflare devem garantir estrita segurança:

1. **Modo SSL/TLS: Full (Strict)**
   - O tráfego entre o visitante e o Cloudflare é criptografado via HTTPS.
   - O tráfego entre o Cloudflare e o Heroku é obrigatoriamente criptografado e validado contra certificado público confiável.
   - **Proibição estrita de modo Flexible**: O modo Flexible transmite tráfego em texto claro para a origem, violando a política de privacidade.

2. **Always Use HTTPS**: `on`
   - Todo tráfego HTTP na porta 80 é automaticamente redirecionado com código HTTP 301 para HTTPS na porta 443.

3. **Versão Mínima de TLS**: `1.2`
   - Rejeita conexões legadas com cifras obsoletas (TLS 1.0 e 1.1 desabilitados).

4. **HTTP Strict Transport Security (HSTS)**:
   - Configurado tanto na borda quanto no Express (`maxAge: 31536000`, `includeSubDomains`, `preload`).

---

## 4. Proteção contra Bots e Ataques (WAF)

No painel Cloudflare (ou via Ruleset API):
- **Bot Fight Mode**: Ativado na zona `hfesc.dev`. Desafia bots automatizados conhecidos sem impactar navegadores legítimos.
- **Security Level**: `Medium` ou `High`.
- **Browser Integrity Check**: Ativado. Inspeciona headers HTTP malformados comumente emitidos por scrapers e scanners vulneráveis.
- **Privacy First (Zero-Telemetry)**: Web Analytics e RUM (Real User Measurement) da Cloudflare desativados para evitar injeção de scripts no DOM do MasterZap.

---

## 5. Script de Automação (`scripts/configure-cloudflare.mjs`)

Para aplicar ou verificar as configurações programaticamente:

### Requisitos de Permissão do Token API
Crie um API Token no Cloudflare Dashboard com as seguintes permissões de zona:
- `Zone.Zone: Read`
- `Zone.DNS: Edit`
- `Zone.Zone Settings: Edit`
- **Recursos da Zona**: `Include -> Specific Zone -> hfesc.dev`

### Execução
```bash
# Via variável de ambiente:
export CLOUDFLARE_API_TOKEN="seu-token-aqui"
node scripts/configure-cloudflare.mjs

# Ou gravando no arquivo seguro (ignorado pelo git):
mkdir -p .secrets
echo "seu-token-aqui" > .secrets/cloudflare-token
node scripts/configure-cloudflare.mjs
```

### Verificação de Status
```bash
node scripts/configure-cloudflare.mjs --status
```

---

## 6. Procedimento de Validação Operacional

Após propagação do DNS:

1. **Verificação de DNS:**
   ```bash
   dig masterzap.hfesc.dev
   # Deve retornar os IPs anycast da Cloudflare (104.x.x.x ou 172.x.x.x), não o CNAME herokudns direto
   ```

2. **Verificação de Proxy e Headers HTTP:**
   ```bash
   curl -I https://masterzap.hfesc.dev/healthz
   ```
   **Evidências esperadas:**
   - `HTTP/2 200`
   - Header `cf-ray: ...` confirmando passagem pelo Cloudflare
   - Header `strict-transport-security: max-age=31536000; includeSubDomains; preload`
   - Ausência de headers expondo dados internos do dyno

3. **Verificação de Redirecionamento HTTPS:**
   ```bash
   curl -I http://masterzap.hfesc.dev/
   # Deve retornar HTTP 301 com Location: https://masterzap.hfesc.dev/
   ```
