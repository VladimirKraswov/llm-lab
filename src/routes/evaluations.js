const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const {
  importEvalDataset,
  runEvaluationBenchmark,
  parseEvalTxt,
  getAvailableEvalPromptVariables,
  DEFAULT_EVAL_PROMPT,
} = require('../services/evaluations');

const {
  getEvalDatasets,
  removeEvalDataset,
} = require('../services/state');

const { getJobById } = require('../services/jobs');
const { uid } = require('../utils/ids');

router.post('/datasets/validate', async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const { samples, errors } = parseEvalTxt(content);

    res.json({
      validCount: samples.length,
      invalidCount: errors.length,
      errors: errors.slice(0, 50),
      preview: samples.slice(0, 5),
    });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/datasets/import', async (req, res) => {
  try {
    const { name, content } = req.body || {};
    if (!name || !content) {
      return res.status(400).json({ error: 'name and content are required' });
    }

    const meta = await importEvalDataset(name, content);
    res.json(meta);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.get('/datasets', async (_req, res) => {
  try {
    const list = await getEvalDatasets();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/datasets/:id', async (req, res) => {
  try {
    const list = await getEvalDatasets();
    const ds = list.find((x) => x.id === req.params.id);
    if (!ds) {
      return res.status(404).json({ error: 'dataset not found' });
    }

    const samples = JSON.parse(fs.readFileSync(ds.jsonPath, 'utf8'));
    res.json({ ...ds, samples });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.delete('/datasets/:id', async (req, res) => {
  try {
    const list = await getEvalDatasets();
    const ds = list.find((x) => x.id === req.params.id);

    if (ds) {
      if (fs.existsSync(ds.jsonPath)) fs.unlinkSync(ds.jsonPath);
      if (fs.existsSync(ds.txtPath)) fs.unlinkSync(ds.txtPath);
    }

    await removeEvalDataset(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/config', async (_req, res) => {
  try {
    res.json({
      defaultPromptTemplate: DEFAULT_EVAL_PROMPT,
      availableVariables: getAvailableEvalPromptVariables(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/benchmark', async (req, res) => {
  try {
    const { datasetId, targets, name, promptTemplate } = req.body || {};

    if (!datasetId || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'datasetId and targets array are required' });
    }

    const jobId = uid('job');

    runEvaluationBenchmark(jobId, {
      datasetId,
      targets,
      name,
      promptTemplate,
    }).catch((err) => {
      console.error('Benchmark background error:', err);
    });

    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/jobs/:id/result', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }

    const resultFile = path.join(job.outputDir, 'result.json');
    if (!fs.existsSync(resultFile)) {
      return res
        .status(404)
        .json({ error: 'result.json not found yet. The job might still be running or failed.' });
    }

    const data = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/jobs/:id/summary', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }

    const csvFile = path.join(job.outputDir, 'summary.csv');
    if (!fs.existsSync(csvFile)) {
      return res.status(404).json({ error: 'summary.csv not found' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=summary_${req.params.id}.csv`
    );

    fs.createReadStream(csvFile).pipe(res);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/jobs/:id/detailed', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }

    const csvFile = path.join(job.outputDir, 'detailed.csv');
    if (!fs.existsSync(csvFile)) {
      return res.status(404).json({ error: 'detailed.csv not found' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=detailed_${req.params.id}.csv`
    );

    fs.createReadStream(csvFile).pipe(res);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;