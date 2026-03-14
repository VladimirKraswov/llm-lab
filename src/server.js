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

async function main() {
  await ensureWorkspace();
  await recoverState();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: `${CONFIG.maxJsonMb}mb` }));

  // API
  app.use('/health', healthRoute);
  app.use('/settings', settingsRoute);
  app.use('/datasets', datasetsRoute);
  app.use('/jobs', jobsRoute);
  app.use('/runtime', runtimeRoute);
  app.use('/dashboard', dashboardRoute);
  app.use('/events', eventsRoute);
  app.use('/models', modelsRoute);
  app.use('/loras', lorasRoute);

  // Frontend static
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
    req.path.startsWith('/loras')
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

  app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`LLM Lab Service listening on http://${CONFIG.host}:${CONFIG.port}`);
    console.log(`Workspace: ${CONFIG.workspace}`);
    console.log(`Python: ${CONFIG.pythonBin}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
