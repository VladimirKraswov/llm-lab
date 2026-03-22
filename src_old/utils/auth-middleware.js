const { verifyToken } = require('../services/auth');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  const isCallback =
    req.method === 'POST' &&
    (
      req.path === '/status' ||
      req.path === '/progress' ||
      req.path === '/final' ||
      req.path === '/logs' ||
      req.path.startsWith('/upload/')
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

  if (req.method === 'GET' && req.path.endsWith('/config') && req.query?.token) {
    return next();
  }

  if (req.method === 'GET' && req.path.includes('/dataset/') && req.query?.token) {
    return next();
  }

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
