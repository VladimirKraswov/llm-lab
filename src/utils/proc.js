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
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function killProcessGroup(pid, signal = 'SIGTERM') {
  if (!pid) return;
  try {
    // Try to kill the process group (negative pid)
    process.kill(-pid, signal);
  } catch (e) {
    // Fallback to killing just the process if group kill fails
    try {
      process.kill(pid, signal);
    } catch (e2) {
      // Ignore if process already dead
    }
  }
}

module.exports = {
  runText,
  isPidRunning,
  killProcessGroup,
};
