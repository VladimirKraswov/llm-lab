const { spawn, spawnSync } = require('child_process');

function runText(cmd, args = [], options = {}) {
  const res = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

function isPidRunning(pid) {
  if (!pid) return false;
  const r = runText('bash', ['-lc', `ps -p ${pid} -o pid=`]);
  return r.ok && !!r.stdout;
}

module.exports = {
  runText,
  isPidRunning,
};
