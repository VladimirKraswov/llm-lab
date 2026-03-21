const { verifyToken } = require('../services/auth');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';

  // 1. Обычный JWT для UI / API пользователей
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  // 2. Worker callbacks: пропускаем дальше, а реальную проверку делает route-level callbackAuth
  const isCallback =
    req.method === 'POST' &&
    (
      req.path === '/status' ||
      req.path === '/progress' ||
      req.path === '/final' ||
      req.path === '/logs'
    );

  if (isCallback) {
    const hasBearer = authHeader.startsWith('Bearer ');
    const hasBodyToken =
      !!req.body?.auth_token ||
      !!req.body?.callback_auth_token;

    if (hasBearer || hasBodyToken) {
      return next();
    }
  }

  // 3. Bootstrap config по одноразовому token в query
  if (req.method === 'GET' && req.path.endsWith('/config') && req.query?.token) {
    return next();
  }

  // 4. Датасет для remote trainer по token в query
  if (req.method === 'GET' && req.path.includes('/dataset/') && req.query?.token) {
    return next();
  }

  // 5. SSE events: пропускаем дальше, если есть token в query
  if (req.method === 'GET' && req.path === '/events' && req.query?.token) {
    const decoded = verifyToken(req.query.token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  return res.status(401).json({ error: 'Unauthorized: No valid token provided' });
}

module.exports = authMiddleware;