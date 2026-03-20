const axios = require('axios');
const { getJobById, upsertJob } = require('./jobs');
const { db } = require('../db');
const logger = require('../utils/logger');

async function fetchHuggingFaceContent(repoId, path, responseType = 'json') {
  const url = `https://huggingface.co/${repoId}/resolve/main/${path}`;
  const token = process.env.HF_TOKEN;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    const response = await axios.get(url, { headers, timeout: 15000, responseType });
    return response.data;
  } catch (err) {
    if (err.response?.status === 404) {
      return null;
    }
    logger.warn(`Failed to fetch ${path} from HF repo ${repoId}`, {
      status: err.response?.status,
      message: err.message,
    });
    return null;
  }
}

async function syncJobFromHF(jobId) {
  const job = await getJobById(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  const repoId = job.hfRepoIdMetadata || job.hfRepoIdLora || job.hfRepoIdMerged;
  if (!repoId) {
    throw new Error(`No Hugging Face repository associated with job ${jobId}`);
  }

  logger.info(`Syncing job ${jobId} from HF repo ${repoId}`);

  const [resultData, configData, summaryData, logsText] = await Promise.all([
    fetchHuggingFaceContent(repoId, 'artifacts/result/job-result.json'),
    fetchHuggingFaceContent(repoId, 'artifacts/config/effective-job.json'),
    fetchHuggingFaceContent(repoId, 'artifacts/train/train_summary.json'),
    fetchHuggingFaceContent(repoId, 'artifacts/logs/trainer.log', 'text'),
  ]);

  const patch = {};

  if (resultData) {
    patch.finalPayload = resultData;
    if (resultData.training?.summary) {
      patch.summaryMetrics = {
        ...patch.summaryMetrics,
        ...resultData.training.summary,
      };
    }
    if (resultData.evaluation?.summary) {
       patch.summaryMetrics = {
         ...patch.summaryMetrics,
         evaluation: resultData.evaluation.summary
       };
    }
  }

  if (summaryData) {
    patch.summaryMetrics = {
      ...(patch.summaryMetrics || job.summaryMetrics || {}),
      ...summaryData,
    };
  }

  if (configData) {
    patch.paramsSnapshot = configData;
  }

  if (logsText) {
    // Clear existing remote logs to avoid duplication if we re-sync
    await db('job_logs').where({ job_id: jobId }).delete();

    // Chunk logs and insert
    const chunkSize = 16 * 1024;
    for (let i = 0; i < logsText.length; i += chunkSize) {
      const chunk = logsText.slice(i, i + chunkSize);
      await db('job_logs').insert({
        job_id: jobId,
        content: chunk,
        offset: i,
      });
    }

    patch.logChunkCount = Math.ceil(logsText.length / chunkSize);
    patch.lastLogOffset = logsText.length;
  }

  if (Object.keys(patch).length === 0) {
    logger.warn(`No syncable artifacts found for job ${jobId} in HF repo ${repoId}`);
    return { ok: false, message: 'No artifacts found on Hugging Face' };
  }

  const updatedJob = {
    ...job,
    ...patch,
  };

  await upsertJob(updatedJob);
  logger.info(`Successfully synced job ${jobId} from Hugging Face`);

  return { ok: true };
}

module.exports = {
  syncJobFromHF,
};
