# Relatório de Capacidade e Dimensionamento de Dyno Heroku

Este documento apresenta os resultados empíricos de medição de capacidade do servidor Express do **MasterWhats** executando sobre Node 22 com o acervo integral de dados (66.387 mensagens, 24 conversas, 534 dias, índices de busca e exports completos).

---

## 1. Resumo Executivo e Recomendação de Dyno

| Métrica | Valor Medido | Limite Dyno Basic (512 MB) | Margem de Segurança |
| :--- | :---: | :---: | :---: |
| **Tempo de Startup** | **13,04 ms** | N/A | Instantâneo |
| **RSS Ocioso (Pós-warmup)** | **79,61 MB** | 512 MB | 84,4% livre |
| **Pico Máximo de RSS** | **164,69 MB** | 512 MB | **67,8% livre (347 MB livres)** |
| **Heap Node.js Utilizado** | **12,14 MB** | N/A | Altamente eficiente |
| **Streaming de 17 MB** | **52,09 ms** | N/A | Sem retenção em memória |
| **Erros HTTP / Timeout** | **0** em todos os níveis | 0 | 100% sucesso |

### Recomendação Final
O plano **Heroku Basic** ($7/mês, 512 MB RAM, dyno sempre ativo sem sleep) é **plenamente aprovado** e atende com ampla folga de **67,8% de memória livre**. O plano cobre perfeitamente o domínio customizado com TLS e Cloudflare sem risco de OOM (Out Of Memory) nem degradação de latência.

---

## 2. Inventário do Acervo Estático em Produção

- **Total em `public/data/`**: 21 MB (índices, conversas e chunks diários particionados por data)
- **Total em `public/export/`**: 67 MB (markdown, json e zip exportáveis por conversa)
- **Total em `dist/` (build de produção)**: 98 MB
- **Maior arquivo unitário**: `dist/export/masterwhats-martha-graeff.json` (17,6 MB)
- **Índice de busca principal**: `dist/data/martha-graeff/search-index.json` (5,2 MB)

---

## 3. Resultados de Latência e Throughput sob Concorrência

Medições realizadas com 1, 5, 10 e 25 clientes simultâneos:

### 3.1. Healthcheck (`/healthz`)
| Concorrência | Requisições | Mediana | p95 | Throughput | Erros | RSS |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 5 | 1,50 ms | 2,45 ms | 501,4 req/s | 0 | 80,2 MB |
| 5 | 25 | 5,33 ms | 15,83 ms | 712,9 req/s | 0 | 82,0 MB |
| 10 | 50 | 9,25 ms | 22,17 ms | 925,9 req/s | 0 | 84,5 MB |
| 25 | 125 | 23,35 ms | 119,17 ms | 778,9 req/s | 0 | 87,6 MB |

### 3.2. App Shell & Login (`/auth/login`)
| Concorrência | Requisições | Mediana | p95 | Throughput | Erros | RSS |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 5 | 0,88 ms | 1,17 ms | 964,7 req/s | 0 | 88,0 MB |
| 5 | 25 | 6,19 ms | 9,09 ms | 735,5 req/s | 0 | 89,9 MB |
| 10 | 50 | 8,98 ms | 14,81 ms | 977,1 req/s | 0 | 92,9 MB |
| 25 | 125 | 22,16 ms | 26,97 ms | 1070,1 req/s | 0 | 97,7 MB |

### 3.3. Catálogo de Conversas (`/data/conversations.json`)
| Concorrência | Requisições | Mediana | p95 | Throughput | Erros | RSS |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 5 | 1,84 ms | 3,20 ms | 472,9 req/s | 0 | 97,9 MB |
| 5 | 25 | 7,48 ms | 10,98 ms | 606,5 req/s | 0 | 101,5 MB |
| 10 | 50 | 15,95 ms | 30,73 ms | 502,5 req/s | 0 | 113,0 MB |
| 25 | 125 | 36,75 ms | 44,27 ms | 668,7 req/s | 0 | 124,5 MB |

### 3.4. Chunk Diário Lazy (`/data/martha-graeff/2024-02-10.json`)
| Concorrência | Requisições | Mediana | p95 | Throughput | Erros | RSS |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 5 | 1,25 ms | 2,51 ms | 644,0 req/s | 0 | 124,6 MB |
| 5 | 25 | 5,98 ms | 10,81 ms | 706,1 req/s | 0 | 124,7 MB |
| 10 | 50 | 11,49 ms | 19,23 ms | 781,7 req/s | 0 | 124,8 MB |
| 25 | 125 | 28,17 ms | 32,59 ms | 873,8 req/s | 0 | 132,4 MB |

### 3.5. Páginas Pré-renderizadas (`/chat/martha-graeff/`)
| Concorrência | Requisições | Mediana | p95 | Throughput | Erros | RSS |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 5 | 1,18 ms | 1,65 ms | 744,4 req/s | 0 | 132,4 MB |
| 5 | 25 | 5,28 ms | 5,58 ms | 927,2 req/s | 0 | 132,4 MB |
| 10 | 50 | 15,49 ms | 17,12 ms | 641,4 req/s | 0 | 137,7 MB |
| 25 | 125 | 29,23 ms | 47,20 ms | 774,4 req/s | 0 | 143,3 MB |

### 3.6. Índice de Busca Pesado (`/data/martha-graeff/search-index.json` - 5,2 MB)
| Concorrência | Requisições | Mediana | p95 | Throughput | Erros | RSS |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 5 | 22,97 ms | 38,91 ms | 40,7 req/s | 0 | 155,3 MB |
| 5 | 25 | 84,70 ms | 129,49 ms | 54,5 req/s | 0 | 147,9 MB |
| 10 | 50 | 198,80 ms | 379,69 ms | 41,4 req/s | 0 | 161,7 MB |
| 25 | 125 | 412,28 ms | 619,19 ms | 57,2 req/s | 0 | 164,7 MB |

---

## 4. Validação de Streaming de Arquivos Grandes

O Express serve arquivos através de streams HTTP (`express.static` e `res.sendFile`), sem carregar arquivos completos para a memória do processo V8:

- **Arquivo testado**: `dist/export/masterwhats-martha-graeff.json` (17.615.023 bytes)
- **Tempo de transferência local**: 52,09 ms
- **Memória RSS antes do stream**: 164,69 MB
- **Memória RSS após o stream**: 156,60 MB (liberação imediata pelos buffers de rede)
- **Conclusão**: O consumo de memória do Node.js é descorrelacionado do tamanho dos arquivos exportados, garantindo estabilidade operacional.
