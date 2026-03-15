const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const { addDataset } = require('./state');
const logger = require('../utils/logger');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function asMessages(userText, assistantText) {
  return {
    messages: [
      { role: 'user', content: String(userText || '').trim() },
      { role: 'assistant', content: String(assistantText || '').trim() },
    ],
  };
}

function tryNormalizeSyntheticRecord(item) {
  if (!item || typeof item !== 'object') {
    throw new Error('Row is not an object');
  }

  // Already in target format
  if (Array.isArray(item.messages)) {
    if (item.messages.length < 2) {
      throw new Error('messages must contain at least 2 items');
    }

    for (const msg of item.messages) {
      if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
        throw new Error('each message must have string role and content');
      }
      if (!msg.role.trim()) throw new Error('message.role cannot be empty');
      if (!msg.content.trim()) throw new Error('message.content cannot be empty');
    }

    return {
      normalized: { messages: item.messages },
      sourceFormat: 'messages',
    };
  }

  // Classic instruction-output
  if (isNonEmptyString(item.instruction) && isNonEmptyString(item.output)) {
    return {
      normalized: asMessages(item.instruction, item.output),
      sourceFormat: 'instruction-output',
    };
  }

  // Prompt-completion
  if (isNonEmptyString(item.prompt) && isNonEmptyString(item.completion)) {
    return {
      normalized: asMessages(item.prompt, item.completion),
      sourceFormat: 'prompt-completion',
    };
  }

  // Question-answer
  if (isNonEmptyString(item.question) && isNonEmptyString(item.answer)) {
    return {
      normalized: asMessages(item.question, item.answer),
      sourceFormat: 'question-answer',
    };
  }

  // Input-output
  if (isNonEmptyString(item.input) && isNonEmptyString(item.output)) {
    return {
      normalized: asMessages(item.input, item.output),
      sourceFormat: 'input-output',
    };
  }

  // Context-response
  if (isNonEmptyString(item.context) && isNonEmptyString(item.response)) {
    return {
      normalized: asMessages(item.context, item.response),
      sourceFormat: 'context-response',
    };
  }

  // Synthetic-style instruction/response
  if (isNonEmptyString(item.instruction) && isNonEmptyString(item.response)) {
    return {
      normalized: asMessages(item.instruction, item.response),
      sourceFormat: 'instruction-response',
    };
  }

  // Synthetic-style question/response
  if (isNonEmptyString(item.question) && isNonEmptyString(item.response)) {
    return {
      normalized: asMessages(item.question, item.response),
      sourceFormat: 'question-response',
    };
  }

  // Synthetic-style prompt/answer
  if (isNonEmptyString(item.prompt) && isNonEmptyString(item.answer)) {
    return {
      normalized: asMessages(item.prompt, item.answer),
      sourceFormat: 'prompt-answer',
    };
  }

  // Some synthetic kits emit "input" + "answer"
  if (isNonEmptyString(item.input) && isNonEmptyString(item.answer)) {
    return {
      normalized: asMessages(item.input, item.answer),
      sourceFormat: 'input-answer',
    };
  }

  // Some synthetic kits may emit nested fields
  if (
    item.record &&
    typeof item.record === 'object' &&
    isNonEmptyString(item.record.question) &&
    isNonEmptyString(item.record.answer)
  ) {
    return {
      normalized: asMessages(item.record.question, item.record.answer),
      sourceFormat: 'record.question-answer',
    };
  }

  // Generic fallback: common keys
  const possibleUserKeys = ['user', 'query', 'task', 'request'];
  const possibleAssistantKeys = ['assistant', 'result', 'completion', 'generated_answer'];

  const userKey = possibleUserKeys.find((k) => isNonEmptyString(item[k]));
  const assistantKey = possibleAssistantKeys.find((k) => isNonEmptyString(item[k]));

  if (userKey && assistantKey) {
    return {
      normalized: asMessages(item[userKey], item[assistantKey]),
      sourceFormat: `${userKey}-${assistantKey}`,
    };
  }

  throw new Error(
    `Unsupported synthetic row format. Keys: ${Object.keys(item).sort().join(', ') || '(none)'}`
  );
}

function parseSyntheticJsonl(jsonl) {
  const lines = String(jsonl || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

  const valid = [];
  const invalid = [];
  const formats = new Map();

  lines.forEach((line, index) => {
    try {
      const parsed = JSON.parse(line);
      const { normalized, sourceFormat } = tryNormalizeSyntheticRecord(parsed);

      formats.set(sourceFormat, (formats.get(sourceFormat) || 0) + 1);

      valid.push({
        line: index + 1,
        original: parsed,
        normalized,
        sourceFormat,
      });
    } catch (err) {
      invalid.push({
        line: index + 1,
        error: String(err.message || err),
        raw: line,
      });
    }
  });

  const sortedFormats = [...formats.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  return {
    totalLines: lines.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    valid,
    invalid,
    detectedFormats: sortedFormats,
    detectedFormat: sortedFormats[0] || 'unknown',
  };
}

async function importSyntheticDatasetFromJsonlFile(name, filePath, options = {}) {
  const datasetName = String(name || '').trim();
  if (!datasetName) {
    throw new Error('Dataset name is required');
  }

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Synthetic dataset file not found: ${filePath}`);
  }

  const jsonl = await fsp.readFile(filePath, 'utf8');
  return importSyntheticDatasetFromJsonl(datasetName, jsonl, {
    sourcePath: filePath,
    ...options,
  });
}

async function importSyntheticDatasetFromJsonl(name, jsonl, options = {}) {
  const sampleLine = String(jsonl || '')
    .split('\n')
    .map((x) => x.trim())
    .find(Boolean) || '';

  logger.info('Synthetic dataset import sample', {
    datasetName: name,
    sourcePath: options.sourcePath || null,
    sampleLine: sampleLine.slice(0, 2000),
  });

  const parsed = parseSyntheticJsonl(jsonl);

  if (!parsed.validCount) {
    const firstError = parsed.invalid[0];
    throw new Error(
      `Synthetic dataset import failed: 0 valid rows. First error: ${firstError?.error || 'unknown error'}`
    );
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
    sourceFormat: `synthetic:${parsed.detectedFormat}`,
    sourceFormats: parsed.detectedFormats,
    rawPath,
    processedPath,
    rows: normalizedLines.length,
    invalidRows: parsed.invalidCount,
    syntheticImport: true,
    syntheticSourcePath: options.sourcePath || null,
  };

  logger.info('Synthetic dataset imported', {
    datasetId,
    name,
    rows: meta.rows,
    invalidRows: meta.invalidRows,
    detectedFormats: parsed.detectedFormats,
  });

  return addDataset(meta);
}

module.exports = {
  tryNormalizeSyntheticRecord,
  parseSyntheticJsonl,
  importSyntheticDatasetFromJsonl,
  importSyntheticDatasetFromJsonlFile,
};