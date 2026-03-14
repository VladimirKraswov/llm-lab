// src/services/datasets.js

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
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

async function parseJsonlStream(inputStream, onValid) {
  const rl = readline.createInterface({
    input: inputStream,
    terminal: false,
  });

  let detectedFormat = null;
  let totalLines = 0;
  let validCount = 0;
  let invalidCount = 0;
  const invalid = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalLines++;
    try {
      const parsed = JSON.parse(line);
      const fmt = detectFormat(parsed);
      if (!detectedFormat && fmt !== 'unknown') detectedFormat = fmt;

      const normalized = normalizeConversationRecord(parsed);
      validateMessages(normalized.messages);

      validCount++;
      if (onValid) await onValid(normalized);
    } catch (err) {
      invalidCount++;
      if (invalid.length < 100) {
        invalid.push({
          line: totalLines,
          error: String(err.message || err),
          raw: line.slice(0, 1000),
        });
      }
    }
  }

  return {
    detectedFormat: detectedFormat || 'unknown',
    totalLines,
    validCount,
    invalidCount,
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
  const datasetId = uid('ds');
  const rawPath = path.join(CONFIG.rawDatasetsDir, `${datasetId}.jsonl`);
  const processedPath = path.join(CONFIG.datasetsDir, `${datasetId}.jsonl`);

  await fsp.writeFile(rawPath, jsonl, 'utf8');

  const writeStream = fs.createWriteStream(processedPath);
  const stream = fs.createReadStream(rawPath);

  const result = await parseJsonlStream(stream, async (normalized) => {
    const ok = writeStream.write(JSON.stringify(normalized) + '\n');
    if (!ok) {
      await new Promise((resolve) => writeStream.once('drain', resolve));
    }
  });

  await new Promise((resolve) => {
    writeStream.end(resolve);
  });

  if (result.validCount === 0) {
    await fsp.rm(rawPath).catch(() => {});
    await fsp.rm(processedPath).catch(() => {});
    throw new Error('No valid rows found in jsonl');
  }

  const meta = {
    id: datasetId,
    name,
    createdAt: nowIso(),
    format: 'chat-jsonl',
    sourceFormat: result.detectedFormat,
    rawPath,
    processedPath,
    rows: result.validCount,
    invalidRows: result.invalidCount,
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

  const stream = fs.createReadStream(ds.processedPath);
  const rl = readline.createInterface({
    input: stream,
    terminal: false,
  });

  const preview = [];
  let count = 0;
  for await (const line of rl) {
    if (count >= limit) break;
    if (line.trim()) {
      preview.push(JSON.parse(line));
      count++;
    }
  }
  rl.close();
  stream.destroy();

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

async function validateJsonl(jsonl) {
  const { Readable } = require('stream');
  const stream = Readable.from([jsonl]);

  const preview = [];
  const result = await parseJsonlStream(stream, async (normalized) => {
    if (preview.length < 5) preview.push(normalized);
  });

  return {
    ok: result.validCount > 0,
    detectedFormat: result.detectedFormat,
    totalLines: result.totalLines,
    validCount: result.validCount,
    invalidCount: result.invalidCount,
    preview,
    errors: result.invalid.slice(0, 10),
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