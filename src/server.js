const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { CONFIG } = require('./config');
const { ensureWorkspace, recoverState } = require('./services/state');

const healthRoute = require('./routes/health');
const settingsRoute = require('./routes/settings');
const datasetsRoute = require('./routes/datasets');
const jobsRoute = require('./routes/jobs');
const runtimeRoute = require('./routes/runtime');
const dashboardRoute = require('./routes/dashboard');
const eventsRoute = require('./routes/events');
const modelsRoute = require('./routes/models');
const lorasRoute = require('./routes/loras');
const logsRoute = require('./routes/logs');
const monitorRoute = require('./routes/monitor');
const syntheticRoute = require('./routes/synthetic');
const comparisonsRoute = require('./routes/comparisons');

function buildCorsOrigin() {
  if (!CONFIG.webUiOrigin || CONFIG.webUiOrigin === '*') {
    return true;
  }
  return CONFIG.webUiOrigin;
}

async function main() {
  try {
    console.log('Initializing workspace...');
    await ensureWorkspace();
    console.log('Recovering state...');
    await recoverState();
    console.log('Starting Express app...');
  } catch (err) {
    console.error('Critical failure during initialization:');
    console.error(err);
    process.exit(1);
  }

  const app = express();

  app.use(cors({
    origin: buildCorsOrigin(),
    credentials: false,
  }));

  app.use(express.json({ limit: `${CONFIG.maxJsonMb}mb` }));

  app.use('/health', healthRoute);
  app.use('/settings', settingsRoute);
  app.use('/datasets', datasetsRoute);
  app.use('/jobs', jobsRoute);
  app.use('/runtime', runtimeRoute);
  app.use('/dashboard', dashboardRoute);
  app.use('/events', eventsRoute);
  app.use('/models', modelsRoute);
  app.use('/loras', lorasRoute);
  app.use('/logs', logsRoute);
  app.use('/monitor', monitorRoute);
  app.use('/synthetic', syntheticRoute);
  app.use('/comparisons', comparisonsRoute);

  const webDist = path.join(__dirname, '..', 'web', 'dist');

  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));

    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/health') ||
        req.path.startsWith('/settings') ||
        req.path.startsWith('/datasets') ||
        req.path.startsWith('/jobs') ||
        req.path.startsWith('/runtime') ||
        req.path.startsWith('/dashboard') ||
        req.path.startsWith('/events') ||
        req.path.startsWith('/models') ||
        req.path.startsWith('/loras') ||
        req.path.startsWith('/logs') ||
        req.path.startsWith('/monitor') ||
        req.path.startsWith('/synthetic') ||
        req.path.startsWith('/comparisons')
      ) {
        return next();
      }

      res.sendFile(path.join(webDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({
        ok: true,
        message: 'Backend is running, but frontend is not built',
      });
    });
  }

  const server = app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`LLM Lab Service listening on http://${CONFIG.host}:${CONFIG.port}`);
    console.log(`Workspace: ${CONFIG.workspace}`);
    console.log(`Python: ${CONFIG.pythonBin}`);
    console.log(`Web UI origin: ${CONFIG.webUiOrigin}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${CONFIG.port} is already in use.`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});