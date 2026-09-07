# Baselines de Qualidade de Código e Testes de Mutação

Este documento estabelece os critérios e métricas de qualidade de software para o repositório `masterzap`, definindo os patamares mínimos exigidos para cobertura de código e resistência a mutações (Stryker Mutator).

---

## 1. Cobertura de Testes Unitários (Vitest)

- **Executor de Testes:** Vitest v3.x com ambiente JSDOM e Node.js 22.x
- **Arquivos de Teste:** 24 suítes de teste (`tests/unit/**/*.test.js`)
- **Total de Testes Unitários:** 293 testes automatizados (100% de aprovação)
- **Tempo de Execução:** ~4.09s (execução de testes), ~25s (total incluindo JSDOM e carregamento de corpus)

### Métricas de Cobertura por Módulo Central (`src/lib`)

| Arquivo / Módulo | Cobertura de Declarações (% Stmt) | Cobertura de Ramificações (% Branch) | Cobertura de Funções (% Funcs) | Cobertura de Linhas (% Lines) |
|---|---|---|---|---|
| `src/lib/avatar.js` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/lib/data-store.js` | 89.47% | 85.71% | 88.88% | 89.47% |
| `src/lib/export.js` | 95.83% | 90.00% | 100.00% | 95.83% |
| `src/lib/media.js` | 83.05% | 76.92% | 83.33% | 83.05% |
| `src/lib/read-state.js` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/lib/router.js` | 94.11% | 87.50% | 100.00% | 94.11% |
| `src/lib/search.js` | 88.63% | 86.36% | 100.00% | 88.63% |
| `src/lib/utils.js` | 64.70% | 80.00% | 66.66% | 64.70% |
| **Total `src/lib`** | **87.23%** | **86.75%** | **89.65%** | **87.23%** |

---

## 2. Testes de Mutação (Stryker Mutator)

O teste de mutação insere pequenas alterações sintáticas (mutantes) no código-fonte de produção para validar se a suíte de testes unitários é capaz de detectar as quebras intencionais. Um mutante é considerado **morto (killed)** quando ao menos um teste falha em resposta à mutação, e **sobrevivente (survived)** quando todos os testes passam inalterados.

- **Configuração:** `stryker.config.json`
- **Runner:** `@stryker-mutator/vitest-runner`
- **Análise de Cobertura:** `perTest` (otimizado para rodar apenas os testes que cobrem cada trecho de código)
- **Otimizações de Execução:** `ignoreStatic: true` (ignora mutantes em constantes e expressões no escopo do módulo para evitar re-execução completa da suíte), `disableTypeChecks: false`, `concurrency: 2`
- **Total de Mutantes Gerados:** 645 mutantes
- **Tempo de Execução Completo:** 8 minutos e 47 segundos

### Resultados Globais

| Métrica | Quantidade | Percentual |
|---|---|---|
| **Mutation Score (Total)** | — | **65.58%** |
| **Mutation Score (Código Coberto)** | — | **74.47%** |
| **Mutantes Mortos (Killed)** | 422 | 65.43% |
| **Mutantes por Timeout** | 1 | 0.16% |
| **Mutantes Sobreviventes (Survived)** | 145 | 22.48% |
| **Mutantes Sem Cobertura (No Coverage)** | 77 | 11.94% |
| **Erros de Instrumentação** | 0 | 0.00% |

### Resultados Detalhados por Arquivo Mutado

| Arquivo (`src/lib/`) | Total Mutantes | % Mutation Score | % Score Coberto | # Mortos | # Timeout | # Sobreviventes | # Sem Cobertura |
|---|---|---|---|---|---|---|---|
| `read-state.js` | 21 | **95.24%** | 95.24% | 20 | 0 | 1 | 0 |
| `export.js` | 14 | **85.71%** | 85.71% | 12 | 0 | 2 | 0 |
| `data-store.js` | 104 | **83.65%** | 94.57% | 87 | 0 | 5 | 12 |
| `avatar.js` | 18 | **83.33%** | 83.33% | 14 | 1 | 3 | 0 |
| `router.js` | 73 | **69.86%** | 73.91% | 51 | 0 | 18 | 4 |
| `search.js` | 108 | **68.52%** | 71.15% | 74 | 0 | 30 | 4 |
| `media.js` | 217 | **54.84%** | 59.20% | 119 | 0 | 82 | 16 |
| `utils.js` | 90 | **50.00%** | 91.84% | 45 | 0 | 4 | 41 |
| **Total Consolidado** | **645** | **65.58%** | **74.47%** | **422** | **1** | **145** | **77** |

---

## 3. Diretrizes para o Mutation Gate em CI/CD

1. **Thresholds Configuráveis no Stryker (`stryker.config.json`):**
   - `high`: 80% (meta de excelência para novos componentes)
   - `low`: 60% (patamar mínimo aceitável)
   - `break`: `null` (em CI de PRs rápidos, o teste de mutação pode ser executado em modo de amostragem ou disparado em workflow noturno / manual para preservar cotas de tempo de compilação, mantendo o threshold de alerta em 60%).
2. **Módulos com Maior Risco de Mutação:**
   - `media.js`: Possui 82 mutantes sobreviventes associados a variações de regex em identificadores visuais de mídia que não alteram o comportamento principal nos fixtures atuais.
   - `utils.js`: 41 mutantes sem cobertura correspondem a utilitários de interface de usuário de fallback (`copyText` via `document.execCommand` legado e `formatRelativeDate`).
3. **Estratégia de Manutenção:**
   - Adições em `src/lib/read-state.js`, `src/lib/data-store.js` e `src/lib/router.js` devem manter mutation score ≥ 75%.
