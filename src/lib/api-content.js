/**
 * What the API/MCP page says, around the table it draws from api-routes.js.
 *
 * Same link format as the other content files: {text}[https://…]. The
 * numbers (limits, URLs) come from api-routes.js so the page cannot say one
 * thing and the server do another.
 */

import { MCP_LIMITS, MCP_URL, BULK_RELEASE, SITE_ORIGIN, API_BASE } from './api-routes.js';

export const API_INTRO = {
  title: 'API/MCP',
  sub: 'Os mesmos dados do site, para scripts e para modelos',
};

export const API_SECTIONS = [
  {
    title: 'O que é',
    paragraphs: [
      { text: `Tudo que este site mostra existe como arquivo: JSON por conversa, por dia e por mês, as chamadas, as pessoas citadas. A API é só um nome estável para esses arquivos — ${SITE_ORIGIN}${API_BASE}/… — servidos direto da CDN, sem servidor no meio. Não tem chave, não tem limite, e o que você baixa é exatamente o que o site lê.` },
      { text: 'O MCP é a mesma coisa para modelos: um servidor que um ChatGPT, um Claude ou um Cursor conecta e passa a responder sobre as conversas citando data, página e figura do laudo, com link para a mensagem.' },
    ],
  },
  {
    title: 'Uso justo e limites',
    paragraphs: [
      { text: `A API estática não tem limite — é CDN. O MCP roda numa função e tem cota, para que ninguém consuma o dia do site sozinho: ${MCP_LIMITS.perMinute} chamadas por minuto e ${MCP_LIMITS.perDay} por dia por cliente, e um teto diário para todos. Ao passar, a resposta é 429 com Retry-After e o caminho da API estática, que não fecha.` },
      { text: 'Trezentas chamadas por dia é bastante: as perguntas dos nossos testes com agentes saíram em 6 a 13 chamadas cada. Se precisa de volume, baixe os arquivos — é para isso que eles existem.' },
      { text: 'Os arquivos são imutáveis entre builds: cacheie. Se quiser que a gente saiba quem usa, mande um header X-Client com o nome do seu projeto; não é obrigatório e não muda nada.' },
    ],
  },
  {
    title: 'Tudo de uma vez',
    paragraphs: [
      { text: `Os consolidados — todas as conversas em Markdown, em JSON, e o zip com os pares por conversa — são publicados como {release no GitHub}[${BULK_RELEASE}/masterwhats-export.zip], com banda ilimitada, e não são servidos por aqui. A URL "latest" é estável.` },
    ],
  },
];

/** How to plug the MCP into each client. `code` is copied as is. */
export const MCP_CLIENTS = [
  {
    name: 'ChatGPT',
    steps: [
      'Configurações → Conectores (ou Apps) → ative o modo desenvolvedor.',
      'Criar → cole a URL do servidor abaixo, sem autenticação.',
      'Num chat, ative o conector e pergunte. Os menus mudam de nome com o tempo; a URL é o que importa. O servidor expõe search e fetch no formato que o ChatGPT exige.',
    ],
    code: MCP_URL,
  },
  {
    name: 'Claude (claude.ai)',
    steps: [
      'Configurações → Conectores → Adicionar conector personalizado.',
      'Cole a URL e salve. Sem OAuth.',
    ],
    code: MCP_URL,
  },
  {
    name: 'Claude Code',
    steps: ['Uma linha no terminal:'],
    code: `claude mcp add --transport http masterwhats ${MCP_URL}`,
  },
  {
    name: 'Cursor, Windsurf e outros',
    steps: ['No arquivo de configuração de MCP do cliente (mcp.json ou equivalente):'],
    code: `{\n  "mcpServers": {\n    "masterwhats": { "url": "${MCP_URL}" }\n  }\n}`,
  },
];

/** What the MCP offers, in the words a person reads before connecting. */
export const MCP_TOOLS = [
  ['list_conversations', 'as 24 conversas, com ids'],
  ['get_conversation', 'uma conversa e seus dias'],
  ['get_messages', 'mensagens entre duas datas, com página do laudo e link'],
  ['search', 'busca numa conversa ou em todas'],
  ['fetch', 'uma mensagem com o que a cita e as vizinhas'],
  ['get_calls', 'as chamadas'],
  ['get_person', 'toda menção a uma pessoa'],
];

export const API_CREDITS = `Dúvidas e pedidos: {abra uma issue}[https://github.com/rafaelbressan/masterzap/issues]. As informações são de domínio público; este projeto não tem vinculação com nenhuma das partes.`;
