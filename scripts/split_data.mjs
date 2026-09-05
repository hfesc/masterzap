#!/usr/bin/env node
/**
 * Split messages.json and IPJ conversations into per-date chunks for lazy loading.
 * Node.js ES module port of scripts/split_data.py.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');
const OUTPUT_DIR = path.join(ROOT, 'public', 'data');

export const FULL_TEXT_INDEX_MAX_MESSAGES = 5000;
export const REPORT_PDF = 'data/source/IPJ-A-3298613-2026.pdf';
export const REPORT_PAGES_FALLBACK = 218;

const CALL_RE_PT = /^Chamada de (voz|v[ií]deo)(?: — duração (\d{1,2}:\d{2}))?( perdida)?/i;
const CALL_RE_EN = /^(Missed )?(Voice|Video) call(?:, (\d+) (min|sec)|, (No answer)|, (Ended)|, (Tap to call back))?/i;

/**
 * Convert a name to a URL-friendly slug.
 */
export function slugify(name) {
  let s = (name || '').toLowerCase().trim();
  s = s.replace(/[àáâãäå]/g, 'a');
  s = s.replace(/[èéêë]/g, 'e');
  s = s.replace(/[ìíîï]/g, 'i');
  s = s.replace(/[òóôõö]/g, 'o');
  s = s.replace(/[ùúûü]/g, 'u');
  s = s.replace(/[ç]/g, 'c');
  s = s.replace(/[ñ]/g, 'n');
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

/**
 * Derive conversation ID from participants (excluding DV).
 */
export function getConversationId(metadata) {
  const participants = metadata?.participants || [];
  const other = participants.filter(p => p !== 'DV');
  if (other.length > 0) {
    return slugify(other[0]);
  }
  return slugify(participants.join('-'));
}

/**
 * Group messages by their date field.
 */
export function groupMessagesByDate(messages) {
  const byDate = {};
  for (const msg of messages) {
    if (!byDate[msg.date]) {
      byDate[msg.date] = [];
    }
    byDate[msg.date].push(msg);
  }
  return byDate;
}

/**
 * Slice string by Unicode code points (matching Python string slicing).
 */
function sliceCodePoints(str, maxLen) {
  if (maxLen === null || maxLen === undefined || str.length <= maxLen) {
    return str;
  }
  return Array.from(str).slice(0, maxLen).join('');
}

/**
 * Build lightweight search index, truncating content only when it pays off.
 */
export function buildSearchIndex(messages, maxContentLen = 80) {
  let effectiveMaxLen = maxContentLen;
  if (messages.length <= FULL_TEXT_INDEX_MAX_MESSAGES) {
    effectiveMaxLen = null;
  }
  const entries = [];
  for (const msg of messages) {
    if (msg.type === 'system') {
      continue;
    }
    const content = msg.content || '';
    if (!content.trim()) {
      continue;
    }
    entries.push({
      id: msg.id,
      date: msg.date,
      sender: msg.sender,
      content: effectiveMaxLen === null ? content : sliceCodePoints(content, effectiveMaxLen),
    });
  }
  return entries;
}

/**
 * Write JSON to file, creating directories as needed.
 */
export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
}

/**
 * Describe the police report document: path, hash and page count.
 */
export function describeReportDocument() {
  const fullPath = path.join(ROOT, REPORT_PDF);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  const buffer = fs.readFileSync(fullPath);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  let pages = REPORT_PAGES_FALLBACK;
  try {
    const info = spawnSync('pdfinfo', [fullPath], { encoding: 'utf-8', timeout: 30000 });
    if (info.status === 0 && info.stdout) {
      const m = info.stdout.match(/^Pages:\s+(\d+)/m);
      if (m) {
        pages = parseInt(m[1], 10);
      }
    }
  } catch {
    // pdfinfo not installed or failed, use fallback
  }

  return {
    file: REPORT_PDF,
    url: `https://github.com/rafaelbressan/masterzap/blob/main/${REPORT_PDF}`,
    download: `https://raw.githubusercontent.com/rafaelbressan/masterzap/main/${REPORT_PDF}`,
    sha256: sha,
    pages,
  };
}

/**
 * Parse one call message into standard call record format.
 */
export function describeCall(msg) {
  const text = (msg?.content || '').trim();
  let kind = null;
  let status = null;
  let duration = null;

  const mPt = text.match(CALL_RE_PT);
  if (mPt) {
    const ptKind = mPt[1].toLowerCase();
    kind = ptKind.startsWith('v') && ptKind.includes('d') ? 'video' : 'voice';
    duration = mPt[2] || null;
    status = mPt[3] ? 'missed' : (duration ? 'completed' : 'ended');
  } else {
    const mEn = text.match(CALL_RE_EN);
    if (!mEn) {
      return null;
    }
    kind = mEn[2].toLowerCase();
    if (mEn[1] || mEn[7]) {
      status = 'missed';
    } else if (mEn[5]) {
      status = 'no_answer';
    } else if (mEn[3]) {
      status = 'completed';
      const unit = mEn[4].toLowerCase().startsWith('min') ? 'min' : 's';
      duration = `${mEn[3]} ${unit}`;
    } else {
      status = 'ended';
    }
  }

  return {
    kind,
    status,
    duration,
    outgoing: msg?.sender === 'DV',
  };
}

/**
 * Normalise date range to { start: string, end: string }.
 */
export function normaliseDateRange(dateRange) {
  if (Array.isArray(dateRange)) {
    return { start: dateRange[0], end: dateRange[1] };
  }
  return { start: dateRange.start, end: dateRange.end };
}

/**
 * Load source messages.json and index.json.
 */
export function loadSourceData() {
  const messagesPath = path.join(DATA_DIR, 'messages.json');
  const indexPath = path.join(DATA_DIR, 'index.json');

  if (!fs.existsSync(messagesPath)) {
    console.error(`Error: ${messagesPath} not found`);
    process.exit(1);
  }
  if (!fs.existsSync(indexPath)) {
    console.error(`Error: ${indexPath} not found`);
    process.exit(1);
  }

  console.log('Loading messages.json...');
  const data = JSON.parse(fs.readFileSync(messagesPath, 'utf-8'));

  console.log('Loading index.json...');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  return { data, index };
}

/**
 * Load extra conversations built from IPJ report (data/conversations/).
 */
export function loadExtraConversations() {
  if (!fs.existsSync(CONVERSATIONS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json')).sort();
  const loaded = [];
  for (const file of files) {
    const filePath = path.join(CONVERSATIONS_DIR, file);
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const stem = path.parse(file).name;
    loaded.push([stem, payload, payload.index]);
    console.log(`Loading conversations/${file}...`);
  }
  return loaded;
}

/**
 * Split a single conversation into chunks.
 */
export function splitConversation(convId, data, index, callsList, reportDocument) {
  const metadata = data.metadata;
  const messages = data.messages;
  const convDir = path.join(OUTPUT_DIR, convId);

  const byDate = groupMessagesByDate(messages);
  const dates = Object.keys(byDate).sort();

  writeJson(path.join(convDir, 'index.json'), index);

  const searchIndex = buildSearchIndex(messages);
  const searchIndexPath = path.join(convDir, 'search-index.json');
  writeJson(searchIndexPath, searchIndex);
  const sizeMb = fs.statSync(searchIndexPath).size / (1024 * 1024);

  for (const date of dates) {
    writeJson(path.join(convDir, `${date}.json`), { messages: byDate[date] });
  }

  for (const msg of messages) {
    if (msg.type !== 'call') {
      continue;
    }
    const call = describeCall(msg);
    if (call) {
      callsList.push({
        conversation_id: convId,
        message_id: msg.id,
        date: msg.date,
        timestamp: msg.timestamp,
        ...call,
      });
    }
  }

  console.log(`${convId}: ${messages.length} messages, ${dates.length} dates, search index ${sizeMb.toFixed(1)} MB`);

  const mediaCounts = {
    images: 0,
    videos: 0,
    documents: 0,
  };
  for (const msg of messages) {
    if (msg.type === 'image') mediaCounts.images++;
    else if (msg.type === 'video') mediaCounts.videos++;
    else if (msg.type === 'document') mediaCounts.documents++;
  }

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const other = (metadata.participants || []).filter(p => p !== 'DV');
  const entry = {
    id: convId,
    participants: metadata.participants,
    contact: other.length > 0 ? other[0] : metadata.participants[0],
    date_range: normaliseDateRange(metadata.date_range),
    total_messages: metadata.total_messages,
    media_counts: mediaCounts,
    last_message: lastMsg ? {
      content: sliceCodePoints(lastMsg.content || '', 80),
      timestamp: lastMsg.timestamp,
      sender: lastMsg.sender,
    } : null,
  };

  for (const key of ['phone', 'saved_as', 'source', 'note']) {
    if (metadata[key]) {
      entry[key] = metadata[key];
    }
  }
  if (String(metadata.source || '').startsWith('IPJ-A') && reportDocument) {
    entry.source_document = reportDocument;
  }

  return entry;
}

/**
 * Main execution function.
 */
export function main() {
  const reportDocument = describeReportDocument();
  const { data, index } = loadSourceData();
  const sources = [[getConversationId(data.metadata), data, index]];
  sources.push(...loadExtraConversations());
  console.log();

  const seen = new Set();
  for (const [convId] of sources) {
    if (seen.has(convId)) {
      console.error(`Error: duplicate conversation id '${convId}'`);
      process.exit(1);
    }
    seen.add(convId);
  }

  const calls = [];
  const entries = sources.map(source =>
    splitConversation(source[0], source[1], source[2], calls, reportDocument)
  );

  entries.sort((a, b) => {
    const tsA = a.last_message ? a.last_message.timestamp : '';
    const tsB = b.last_message ? b.last_message.timestamp : '';
    return tsB.localeCompare(tsA);
  });
  writeJson(path.join(OUTPUT_DIR, 'conversations.json'), { conversations: entries });

  calls.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  writeJson(path.join(OUTPUT_DIR, 'calls.json'), { calls });
  console.log(`calls.json: ${calls.length} calls`);

  const total = entries.reduce((acc, e) => acc + e.total_messages, 0);
  console.log(`\nDone! ${entries.length} conversations, ${total} messages in ${OUTPUT_DIR}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
