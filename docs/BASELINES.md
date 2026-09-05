# Baseline Measurements

Date: 2026-09-04
Branch: `chore/harden-and-heroku`
Base Commit: `f3303765a225de432b0004179fd256a933784ac5`
Runtime: Node.js `v22.23.2` / npm `10.9.8` / Python `3.10.12`

---

## 1. Git Repository State

- **Branch:** `chore/harden-and-heroku`
- **Merge Base:** Confirmed ancestor of `origin/main` (`f3303765a225de432b0004179fd256a933784ac5`).
- **Initial Cleanliness:** All subsequent changes isolated on branch.

---

## 2. Production Build Baseline

- **Command:** `npm run build` (`python3 scripts/split_data.py && node scripts/export.mjs && vite build && node scripts/prerender.mjs`)
- **Status:** Succeeded (Exit code 0)
- **Corpus Statistics:**
  - Conversations processed: 24
  - Total messages: 66,387
  - Search index size: 5.2 MB
  - Output size (`dist/`): 98 MB
  - Output files: 89 static assets, chunks, and pre-rendered chat pages

---

## 3. Unit Test and Code Coverage Baseline

- **Command:** `npm run test -- --coverage`
- **Status:** Succeeded (Exit code 0)
- **Suite Results:**
  - Test files: 21 passed (21 total)
  - Tests: 254 passed (254 total, 0 failed, 0 skipped)
  - Duration: 2.37s
- **Coverage Summary:**

| Category | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| **All Files** | **32.32%** (506/1565) | **27.91%** (199/713) | **34.02%** (66/194) | **32.74%** (480/1466) |
| `src/lib/` | **87.23%** (355/407) | **75.48%** (157/208) | **90.38%** (47/52) | **87.42%** (347/397) |
| `src/components/` | **13.03%** (151/1158) | **8.31%** (42/505) | **13.38%** (19/142) | **12.44%** (133/1069) |

---

## 4. End-to-End Test Baseline

- **Command:** `npm run test:e2e` (`playwright test --config tests/e2e/playwright.config.js`)
- **Configuration:** Desktop Chrome, Mobile Chrome, and Pre-render projects (1 worker, headless Chromium 145.0.7632.6)
- **Status:** Succeeded (Exit code 0)
- **Results:**
  - Passed: 298
  - Skipped: 22 (deliberate platform-gated tests)
  - Failed: 0
  - Duration: 17.7 minutes

---

## 5. High and Critical Dependency Audit

- **Command:** `npm audit --audit-level=high`
- **Findings:** 8 vulnerabilities (6 high, 2 critical) across build/test dependencies:
  - `brace-expansion` (DoS)
  - `nanoid` (Predictable results via weak PRNG)
  - `picomatch` (ReDoS)
  - `postcss` (Parsing ReDoS / injection)
  - `undici` (HTTP header/cookie smuggling)
  - `vite` (Dev server SSR / bypass issues)
  - `vitest` / `@vitest/coverage-v8` (Inherited dependencies)

---

## 6. Directory Footprints (`du -sh`)

| Directory | Size | Description |
|---|---|---|
| `src/` | 420 KB | Core frontend application source |
| `public/data/` | 21 MB | Generated per-day conversation JSON chunks |
| `public/export/` | 67 MB | Generated Markdown and JSON export bundles |
| `dist/` | 98 MB | Built production bundle and pre-rendered pages |
| `data/` | 47 MB | Source conversation transcripts and IPJ archives |
| `node_modules/` | 101 MB | Development and build dependencies |
| **Total Root** | **485 MB** | Complete working tree with generated assets |

---

## 7. Secret Scanning Baseline (Gitleaks 8.30.1)

- **History Scan (`gitleaks git --redact -v`):**
  - Findings: 16 occurrences of generic-api-key patterns in historical commits `a345776f` and `6266297c`.
  - Cause: URL query tokens from real estate and photo gallery links shared in WhatsApp chat messages inside `data/messages.json`.
- **Working Tree Scan (`gitleaks dir --redact .`):**
  - Findings: 66 occurrences corresponding to the same 4 message URL tokens replicated into `public/data/`, `public/export/`, and `dist/`.
- **Staged Diff Scan (`gitleaks git --staged --redact`):**
  - Findings: 0 leaks (Clean).
- **Rule Engine Verification:**
  - Synthetic token scanning verified via `.tools/gitleaks-stdin-test.toml`, exiting with code 17 on positive detection.
