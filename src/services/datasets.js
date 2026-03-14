// src/services/datasets.js

const fs = require('fs');
const fsp = require('fs/promises');
const readline = require('readline');
const path = require('path');
const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const { addDataset, getDatasets, saveDatasets } = require('./state');

function normalizeConversationRecord(item) {
  if (Array.isArray(item.messages)) {
    return { messages: item.messages };
  }

  if (typeof item.instruction === 'string' || typeof item.output === 'string') {
    const userText = [item.instruction || '', item.input || ''].filter(Boolean).join('\n\n').trim();
    return {
      messages: [
        { role: 'user', content: userText || '' },
        { role: 'assistant', content: item.output || '' },
      ],
    };
  }

  if (typeof item.prompt === 'string' || typeof item.completion === 'string') {
    return {
      messages: [
        { role: 'user', content: item.prompt || '' },
        { role: 'assistant', content: item.completion || '' },
      ],
    };
  }

  throw new Error('Unsupported dataset record format');
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 2) {
    throw new Error('messages must contain at least 2 items');
  }

  for (const msg of messages) {
    if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
      throw new Error('each message must have string role and content');
    }
    if (!msg.role.trim()) throw new Error('message.role cannot be empty');
    if (!msg.content.trim()) throw new Error('message.content cannot be empty');
  }
}

function detectFormat(item) {
  if (Array.isArray(item?.messages)) return 'messages';
  if (typeof item?.instruction === 'string' || typeof item?.output === 'string') return 'instruction-output';
  if (typeof item?.prompt === 'string' || typeof item?.completion === 'string') return 'prompt-completion';
  return 'unknown';
}

function parseJsonl(jsonl) {
  const lines = String(jsonl || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

  const valid = [];
  const invalid = [];
  let detectedFormat = null;

  lines.forEach((line, index) => {
    try {
      const parsed = JSON.parse(line);
      const fmt = detectFormat(parsed);
      if (!detectedFormat && fmt !== 'unknown') detectedFormat = fmt;

      const normalized = normalizeConversationRecord(parsed);
      validateMessages(normalized.messages);

      valid.push({
        line: index + 1,
        original: parsed,
        normalized,
      });
    } catch (err) {
      invalid.push({
        line: index + 1,
        error: String(err.message || err),
        raw: line,
      });
    }
  });

  return {
    detectedFormat: detectedFormat || 'unknown',
    totalLines: lines.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    valid,
    invalid,
  };
}

function parseItems(items) {
  const list = Array.isArray(items) ? items : [];
  const valid = [];
  const invalid = [];
  let detectedFormat = null;

  list.forEach((item, index) => {
    try {
      const fmt = detectFormat(item);
      if (!detectedFormat && fmt !== 'unknown') detectedFormat = fmt;

      const normalized = normalizeConversationRecord(item);
      validateMessages(normalized.messages);

      valid.push({
        index,
        original: item,
        normalized,
      });
    } catch (err) {
      invalid.push({
        index,
        error: String(err.message || err),
        raw: item,
      });
    }
  });

  return {
    detectedFormat: detectedFormat || 'unknown',
    totalItems: list.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    valid,
    invalid,
  };
}

async function createDatasetFromJsonl(name, jsonl) {
  const parsed = parseJsonl(jsonl);
  if (!parsed.validCount) {
    throw new Error('No valid rows found in jsonl');
  }

  const datasetId = uid('ds');
  const rawPath = path.join(CONFIG.rawDatasetsDir, `${datasetId}.jsonl`);
  const processedPath = path.join(CONFIG.datasetsDir, `${datasetId}.jsonl`);

  await fsp.writeFile(rawPath, jsonl, 'utf8');

  const normalizedLines = parsed.valid.map((x) => JSON.stringify(x.normalized));
  await fsp.writeFile(processedPath, normalizedLines.join('\n') + '\n', 'utf8');

  const meta = {
    id: datasetId,
    name,
    createdAt: nowIso(),
    format: 'chat-jsonl',
    sourceFormat: parsed.detectedFormat,
    rawPath,
    processedPath,
    rows: normalizedLines.length,
    invalidRows: parsed.invalidCount,
  };

  return addDataset(meta);
}

async function createDatasetFromItems(name, items) {
  const parsed = parseItems(items);
  if (!parsed.validCount) {
    throw new Error('No valid items found');
  }

  const datasetId = uid('ds');
  const processedPath = path.join(CONFIG.datasetsDir, `${datasetId}.jsonl`);
  const normalizedLines = parsed.valid.map((x) => JSON.stringify(x.normalized));

  await fsp.writeFile(processedPath, normalizedLines.join('\n') + '\n', 'utf8');

  const meta = {
    id: datasetId,
    name,
    createdAt: nowIso(),
    format: 'chat-jsonl',
    sourceFormat: parsed.detectedFormat,
    processedPath,
    rows: normalizedLines.length,
    invalidRows: parsed.invalidCount,
  };

  return addDataset(meta);
}

async function previewDataset(datasetId, limit = 20) {
  const datasets = await getDatasets();
  const ds = datasets.find((x) => x.id === datasetId);
  if (!ds) throw new Error('dataset not found');

  const fileStream = fs.createReadStream(ds.processedPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const preview = [];
  try {
    for await (const line of rl) {
      if (preview.length >= limit) break;
      const trimmed = line.trim();
      if (trimmed) {
        preview.push(JSON.parse(trimmed));
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return {
    id: ds.id,
    name: ds.name,
    totalRows: ds.rows,
    preview,
  };
}

async function deleteDataset(datasetId) {
  const datasets = await getDatasets();
  const ds = datasets.find((x) => x.id === datasetId);
  if (!ds) throw new Error('dataset not found');

  if (ds.rawPath) {
    await fsp.rm(ds.rawPath, { force: true }).catch(() => {});
  }
  if (ds.processedPath) {
    await fsp.rm(ds.processedPath, { force: true }).catch(() => {});
  }

  const next = datasets.filter((x) => x.id !== datasetId);
  await saveDatasets(next);

  return { ok: true };
}

function validateJsonl(jsonl) {
  const parsed = parseJsonl(jsonl);

  return {
    ok: parsed.validCount > 0,
    detectedFormat: parsed.detectedFormat,
    totalLines: parsed.totalLines,
    validCount: parsed.validCount,
    invalidCount: parsed.invalidCount,
    preview: parsed.valid.slice(0, 5).map((x) => x.normalized),
    errors: parsed.invalid.slice(0, 10),
  };
}

function validateItems(items) {
  const parsed = parseItems(items);

  return {
    ok: parsed.validCount > 0,
    detectedFormat: parsed.detectedFormat,
    totalItems: parsed.totalItems,
    validCount: parsed.validCount,
    invalidCount: parsed.invalidCount,
    preview: parsed.valid.slice(0, 5).map((x) => x.normalized),
    errors: parsed.invalid.slice(0, 10),
  };
}

module.exports = {
  createDatasetFromJsonl,
  createDatasetFromItems,
  previewDataset,
  deleteDataset,
  validateJsonl,
  validateItems,
};