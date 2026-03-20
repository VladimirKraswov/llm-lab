function buildPublicBaseUrl(req, fallback = '') {
  const proto = String(
    req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http'
  )
    .split(',')[0]
    .trim();

  const host = String(
    req?.headers?.['x-forwarded-host'] || req?.get?.('host') || ''
  )
    .split(',')[0]
    .trim();

  if (!host) {
    return String(fallback || '').replace(/\/+$/, '');
  }

  return `${proto}://${host}`.replace(/\/+$/, '');
}

module.exports = {
  buildPublicBaseUrl,
};