const { getSettings, setSettings } = require('../services/state');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.json(await getSettings());
});

router.put('/', async (req, res) => {
  res.json(await setSettings(req.body || {}));
});

module.exports = router;
