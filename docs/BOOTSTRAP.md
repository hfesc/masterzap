# Bootstrap and Tooling Validation

Date: 2026-09-04
Branch: `chore/harden-and-heroku`
Base Commit: `f3303765a225de432b0004179fd256a933784ac5`

---

## 1. Verified Tool Versions and Installation Sources

| Tool | Version | Installation Source / Path | Verification Status |
|---|---|---|---|
| **Node.js** | `v22.23.2` | `fnm` (`/mnt/workspace/home/.local/share/fnm/current/bin/node`) | Verified; pinned via `engines.node: "22.x"` and `.node-version: 22` |
| **npm** | `10.9.8` | Bundled with Node 22 (`engines.npm: "10.x"`) | Verified |
| **Python** | `Python 3.10.12` | `/usr/bin/python3` (system) | Verified for legacy split/build scripts |
| **Git** | `git version 2.34.1` | `/usr/bin/git` | Verified |
| **GitHub CLI (`gh`)** | `gh version 2.45.0` | `/usr/bin/gh` | Verified; authenticated as `hfesc` |
| **Heroku CLI** | `heroku/9.3.1 linux-arm64 node-v20.17.0` | `/usr/local/bin/heroku` | Verified; authenticated as `hfelipe@gmail.com` |
| **Google Cloud SDK (`gcloud`)** | `Google Cloud SDK 489.0.0` | `/usr/bin/gcloud` | Verified; authenticated as `hfelipe@gmail.com` |
| **Playwright** | `Version 1.58.2` | Local `node_modules/.bin/playwright` | Verified with bundled Chromium 145.0.7632.6 |
| **Gitleaks** | `8.30.1` | `.tools/bin/gitleaks` (GitHub Release binary) | Verified; SHA-256 confirmed; stdin scanner verified |
| **cloudflared** | `2026.8.3` (built 2026-08-31-10:05 UTC) | `.tools/bin/cloudflared` (Cloudflare Release binary) | Verified; SHA-256 confirmed |
| **curl** | `curl 7.81.0 (aarch64)` | `/usr/bin/curl` (OpenSSL 3.0.2, HTTP/2, HSTS) | Verified |
| **OpenSSL** | `OpenSSL 3.0.2 15 Mar 2022` | `/usr/bin/openssl` | Verified |
| **dig** | `DiG 9.18.39-0ubuntu0.22.04.6-Ubuntu` | `/usr/bin/dig` | Verified |
| **jq** | `jq-1.6` | `/usr/bin/jq` | Verified |

---

## 2. Authenticated Identities

### GitHub CLI (`gh`)
- **Account:** `hfesc`
- **Active:** `true`
- **Protocol:** `https`
- **Scopes:** `gist`, `read:org`, `repo`, `workflow`

### Heroku CLI
- **Account:** `hfelipe@gmail.com`
- **Existing Apps:** `babelfish-aiostreams`
- **Target App Name (`masterzap-hfesc`):** Not found (no name or ownership conflict)
- **Credit Balance:** Observed US$305.47 remaining balance, valid through July 31, 2028.

### Google Cloud CLI (`gcloud`)
- **Active Account:** `hfelipe@gmail.com`
- **Existing Projects:**
  - `dev-vps-hcamilo`
  - `hugo-sync-drives`
  - `iina-subtitle-translator`
- **Target Project ID (`masterzap-hfesc`):** Available (not yet created)

---

## 3. Cloud Eligibility and Dyno Plan Recommendation

### Cost Policy Enforced
**Zero Unapproved Cloud Cost Policy:** No Heroku dyno or Google Cloud resource will be provisioned before the user explicitly approves the exact plan. All Heroku costs must be consumed by existing account credits (balance US$305.47).

### Plan Analysis (Official Heroku Specifications)

1. **Eco Dynos ($5/month pooled):**
   - Provides 1,000 dyno hours/month shared across all Eco apps.
   - Sleeps after 30 minutes of inactivity (first incoming request wakes dyno within ~5s).
   - Supports custom domains and Automated Certificate Management (ACM).
   - Recommended if occasional wake-up latency on cold start is acceptable.

2. **Basic Dyno ($7/month dedicated):**
   - Always-on (never sleeps).
   - 512 MB RAM.
   - Custom domains and ACM supported.
   - Recommended if immediate zero-sleep response is required.

3. **Standard-1X ($25/month dedicated):**
   - Always-on, 512 MB RAM, runtime metrics, auto-preboot.
   - Not required for MasterZap's static/read-only serving profile.

**Recommendation:** Eco dyno (or Basic dyno if zero cold-sleep is preferred). Both options are 100% covered by the account's US$305.47 credit balance for multiple years.

---

## 4. Pending Human Actions

1. **Cloudflare API Token:**
   - Supply an existing Cloudflare API token scoped to `hfesc.dev` (Permissions: `Zone.Zone:Read`, `Zone.DNS:Edit`, `Zone.Zone Settings:Edit`) via secure terminal input or `.secrets/cloudflare-token` prior to the Cloudflare automation phase.
2. **Heroku Dyno Approval:**
   - Confirm selection between Eco ($5/mo) or Basic ($7/mo).
3. **Google OAuth Project Approval:**
   - Confirm creating project `masterzap-hfesc` under `hfelipe@gmail.com` during the OAuth phase.

---

## 5. Deployment Verification & Edge Telemetry Suppression

### Deployment Smoke Verification Tooling (`scripts/deployment-smoke.mjs`)
- **Script:** `scripts/deployment-smoke.mjs`
- **Purpose:** Standalone verification executed in `.github/workflows/deploy.yml` post-deployment and locally before release sign-off.
- **Verification Criteria:**
  1. `/healthz` responds with HTTP 200 and payload `{"status":"ok", ...}`.
  2. Unauthenticated root (`/`) redirect chain resolves to Google OAuth authorization endpoint (`accounts.google.com`) with zero 5xx server errors.
  3. Absolute zero forbidden edge telemetry headers (`nel`, `report-to`, `reporting-endpoints`) across all responses.

### Cloudflare Edge Ruleset Engine (`http_response_headers_transform`)
- **Phase:** `http_response_headers_transform`
- **Target Zone:** `hfesc.dev`
- **Hostname Filter:** `http.host eq "masterzap.hfesc.dev"`
- **Action:** Modify HTTP response headers before returning to client browser.
- **Headers Removed:**
  - `nel` (Network Error Logging injected by hosting router)
  - `report-to` (Reporting API endpoint groups)
  - `reporting-endpoints` (Modern Reporting API header)
- **Rationale:** Ensures edge routers cannot introduce browser telemetry headers, preserving strict zero-telemetry guarantees.

