const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { CONFIG } = require('./config');
const { ensureWorkspace, recoverState } = require('./services/state');
const { initDb } = require('./db');

const healthRoute = require('./routes/health');
const authRoute = require('./routes/auth');
const authMiddleware = require('./utils/auth-middleware');
const settingsRoute = require('./routes/settings');
const datasetsRoute = require('./routes/datasets');
const jobsRoute = require('./routes/jobs');
const workersRoute = require('./routes/workers');
const runtimeRoute = require('./routes/runtime');
const dashboardRoute = require('./routes/dashboard');
const eventsRoute = require('./routes/events');
const modelsRoute = require('./routes/models');
const lorasRoute = require('./routes/loras');
const logsRoute = require('./routes/logs');
const monitorRoute = require('./routes/monitor');
const syntheticRoute = require('./routes/synthetic');
const comparisonsRoute = require('./routes/comparisons');
const evaluationsRoute = require('./routes/evaluations');
const syncRoute = require('./routes/sync');
const infrastructureRoute = require('./routes/infrastructure');
const { startBackgroundReconcile } = require('./services/reconcile');
const { seedPresets } = require('./services/runtime-presets');
const roleMiddleware = require('./utils/role-middleware');

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
    console.log('Initializing database...');
    await initDb();
    console.log('Recovering state...');
    await recoverState();
    console.log('Seeding presets...');
    await seedPresets();
    console.log('Starting Express app...');
  } catch (err) {
    console.error('Critical failure during initialization:');
    console.error(err);
    process.exit(1);
  }

  const app = express();

  app.set('trust proxy', true);

  app.use(cors({
    origin: buildCorsOrigin(),
    credentials: false,
  }));

  app.use(express.json({ limit: `${CONFIG.maxJsonMb}mb` }));

  const mount = (route, ...handlers) => {
    app.use(route, ...handlers);
    app.use(`/api${route}`, ...handlers);
  };

  mount('/health', healthRoute);
  mount('/auth', authRoute);
  mount('/settings', authMiddleware, settingsRoute);
  mount('/datasets', authMiddleware, datasetsRoute);
  mount('/jobs', authMiddleware, jobsRoute);
  mount('/workers', workersRoute);
  mount('/runtime', authMiddleware, runtimeRoute);
  mount('/dashboard', authMiddleware, dashboardRoute);
  mount('/events', authMiddleware, eventsRoute);
  mount('/models', authMiddleware, modelsRoute);
  mount('/loras', authMiddleware, lorasRoute);
  mount('/logs', authMiddleware, logsRoute);
  mount('/monitor', authMiddleware, monitorRoute);
  mount('/synthetic', authMiddleware, syntheticRoute);
  mount('/comparisons', authMiddleware, comparisonsRoute);
  mount('/evaluations', authMiddleware, evaluationsRoute);
  mount('/sync', authMiddleware, syncRoute);
  mount('/infrastructure', authMiddleware, roleMiddleware(['admin']), infrastructureRoute);

  const webDist = path.join(__dirname, '..', 'web', 'dist');

  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));

    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/settings') ||
        req.path.startsWith('/datasets') ||
        req.path.startsWith('/jobs') ||
        req.path.startsWith('/workers') ||
        req.path.startsWith('/runtime') ||
        req.path.startsWith('/dashboard') ||
        req.path.startsWith('/events') ||
        req.path.startsWith('/models') ||
        req.path.startsWith('/loras') ||
        req.path.startsWith('/logs') ||
        req.path.startsWith('/monitor') ||
        req.path.startsWith('/synthetic') ||
        req.path.startsWith('/comparisons') ||
        req.path.startsWith('/evaluations') ||
        req.path.startsWith('/sync') ||
        req.path.startsWith('/infrastructure')
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

    const reconcileKickoff = startBackgroundReconcile({ reason: 'startup' });
    console.log('Background reconcile scheduled:', reconcileKickoff);
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