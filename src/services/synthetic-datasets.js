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
  const user = String(userText || '').trim();
  const assistant = String(assistantText || '').trim();

  if (!user) throw new Error('user content is empty');
  if (!assistant) throw new Error('assistant content is empty');

  return {
    messages: [
      { role: 'user', content: user },
      { role: 'assistant', content: assistant },
    ],
  };
}

function tryNormalizeSyntheticRecord(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Row is not a JSON object');
  }

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

  if (isNonEmptyString(item.instruction) && isNonEmptyString(item.output)) {
    return {
      normalized: asMessages(item.instruction, item.output),
      sourceFormat: 'instruction-output',
    };
  }

  if (isNonEmptyString(item.prompt) && isNonEmptyString(item.completion)) {
    return {
      normalized: asMessages(item.prompt, item.completion),
      sourceFormat: 'prompt-completion',
    };
  }

  if (isNonEmptyString(item.question) && isNonEmptyString(item.answer)) {
    return {
      normalized: asMessages(item.question, item.answer),
      sourceFormat: 'question-answer',
    };
  }

  if (isNonEmptyString(item.input) && isNonEmptyString(item.output)) {
    return {
      normalized: asMessages(item.input, item.output),
      sourceFormat: 'input-output',
    };
  }

  if (isNonEmptyString(item.context) && isNonEmptyString(item.response)) {
    return {
      normalized: asMessages(item.context, item.response),
      sourceFormat: 'context-response',
    };
  }

  if (isNonEmptyString(item.instruction) && isNonEmptyString(item.response)) {
    return {
      normalized: asMessages(item.instruction, item.response),
      sourceFormat: 'instruction-response',
    };
  }

  if (isNonEmptyString(item.question) && isNonEmptyString(item.response)) {
    return {
      normalized: asMessages(item.question, item.response),
      sourceFormat: 'question-response',
    };
  }

  if (isNonEmptyString(item.prompt) && isNonEmptyString(item.answer)) {
    return {
      normalized: asMessages(item.prompt, item.answer),
      sourceFormat: 'prompt-answer',
    };
  }

  if (isNonEmptyString(item.input) && isNonEmptyString(item.answer)) {
    return {
      normalized: asMessages(item.input, item.answer),
      sourceFormat: 'input-answer',
    };
  }

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

  const detectedFormats = [...formats.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const sampleLine = lines[0] || '';
  let sampleParsed = null;
  try {
    sampleParsed = sampleLine ? JSON.parse(sampleLine) : null;
  } catch {
    sampleParsed = sampleLine || null;
  }

  return {
    totalLines: lines.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    valid,
    invalid,
    invalidSamples: invalid.slice(0, 5),
    detectedFormats,
    detectedFormat: detectedFormats[0] || 'unknown',
    sampleLine,
    sampleParsed,
  };
}

async function importSyntheticDatasetFromJsonl(name, jsonl, options = {}) {
  const parsed = parseSyntheticJsonl(jsonl);

  logger.info('Synthetic dataset import sample', {
    datasetName: name,
    sourcePath: options.sourcePath || null,
    sampleLine: parsed.sampleLine.slice(0, 2000),
    detectedFormats: parsed.detectedFormats,
  });

  if (!parsed.validCount) {
    const firstError = parsed.invalid[0];
    const message =
      `Synthetic dataset import failed: 0 valid rows. ` +
      `First error: ${firstError?.error || 'unknown error'}`;

    const error = new Error(message);
    error.syntheticImportDetails = {
      sampleLine: parsed.sampleLine.slice(0, 2000),
      sampleParsed: parsed.sampleParsed,
      invalidSamples: parsed.invalidSamples,
      detectedFormats: parsed.detectedFormats,
      totalLines: parsed.totalLines,
      validCount: parsed.validCount,
      invalidCount: parsed.invalidCount,
    };
    throw error;
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
    syntheticSampleRow: parsed.sampleParsed,
  };

  logger.info('Synthetic dataset imported', {
    datasetId,
    name,
    rows: meta.rows,
    invalidRows: meta.invalidRows,
    detectedFormats: parsed.detectedFormats,
  });

  return {
    dataset: await addDataset(meta),
    importMeta: {
      sampleLine: parsed.sampleLine.slice(0, 2000),
      sampleParsed: parsed.sampleParsed,
      invalidSamples: parsed.invalidSamples,
      detectedFormats: parsed.detectedFormats,
      totalLines: parsed.totalLines,
      validCount: parsed.validCount,
      invalidCount: parsed.invalidCount,
    },
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

async function previewSyntheticJsonlFile(filePath, limit = 20) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Synthetic dataset file not found: ${filePath}`);
  }

  const jsonl = await fsp.readFile(filePath, 'utf8');
  const parsed = parseSyntheticJsonl(jsonl);

  return {
    path: filePath,
    totalLines: parsed.totalLines,
    validCount: parsed.validCount,
    invalidCount: parsed.invalidCount,
    detectedFormats: parsed.detectedFormats,
    sampleLine: parsed.sampleLine.slice(0, 2000),
    sampleParsed: parsed.sampleParsed,
    preview: parsed.valid.slice(0, limit).map((x) => ({
      line: x.line,
      sourceFormat: x.sourceFormat,
      original: x.original,
      normalized: x.normalized,
    })),
    invalidSamples: parsed.invalidSamples,
  };
}

module.exports = {
  tryNormalizeSyntheticRecord,
  parseSyntheticJsonl,
  importSyntheticDatasetFromJsonl,
  importSyntheticDatasetFromJsonlFile,
  previewSyntheticJsonlFile,
};