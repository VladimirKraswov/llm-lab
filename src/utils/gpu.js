const si = require('systeminformation');
const logger = require('./logger');

/**
 * Forcefully kills all processes that are likely to be using GPU memory.
 * This includes Python, vLLM, and Torch-related processes.
 */
async function clearGpuMemory() {
  try {
    logger.info('Performing automatic GPU memory cleanup...');
    const processes = await si.processes();

    // Identity processes to kill: Python, vLLM, and common ML-related names
    const toKill = processes.list.filter(p => {
      const name = p.name.toLowerCase();
      const cmd = p.command.toLowerCase();
      return (
        name.includes('python') ||
        name.includes('vllm') ||
        name.includes('torch') ||
        cmd.includes('unsloth') ||
        cmd.includes('transformers')
      );
    });

    let killedCount = 0;
    for (const p of toKill) {
      if (p.pid === process.pid) continue; // Don't kill ourselves

      try {
        process.kill(p.pid, 'SIGKILL');
        killedCount++;
      } catch (e) {
        // Process might have already exited
      }
    }

    if (killedCount > 0) {
      logger.info(`GPU cleanup finished: killed ${killedCount} processes.`);
      // Give the OS/Driver a moment to actually free up the VRAM
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      logger.info('GPU cleanup finished: no active ML processes found.');
    }

    return killedCount;
  } catch (err) {
    logger.error('Failed to clear GPU memory:', { error: String(err) });
    return 0;
  }
}

module.exports = {
  clearGpuMemory
};
