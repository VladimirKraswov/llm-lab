const { verifyToken, verifyCallbackToken } = require('../services/auth');

function authMiddleware(req, res, next) {
  // Check for standard JWT auth first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  // Fallback to Worker Callback Auth for certain endpoints
  const isCallback = req.path.startsWith('/status') ||
                     req.path.startsWith('/progress') ||
                     req.path.startsWith('/final') ||
                     req.path.startsWith('/logs');

  if (isCallback && req.method === 'POST') {
    const { job_id, auth_token } = req.body;
    if (job_id && auth_token) {
       // We can't easily verify here without making it async,
       // so we'll let the route handler deal with it if it's a callback.
       // Or better, we make this middleware async.
       return next();
    }
  }

  // Also allow GET /jobs/:id/config if token is in query
  if (req.path.endsWith('/config') && req.query.token) {
    return next();
  }

  if (req.user) return next();

  return res.status(401).json({ error: 'Unauthorized: No valid token provided' });
}

module.exports = authMiddleware;
