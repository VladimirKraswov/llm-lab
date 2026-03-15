const logger = require('./logger');
const { killManagedProcesses, pruneDeadManagedProcesses } = require('./managed-processes');

const DEFAULT_GPU_PROCESS_TYPES = [
  'runtime',
  'fine-tune',
  'model-download',
  'model-quantize',
  'lora-merge',
  'lora-package',
];

/**
 * Clears GPU memory by killing only managed service processes.
 * This avoids killing unrelated Python/ML workloads on the machine.
 */
async function clearGpuMemory(options = {}) {
  const types = Array.isArray(options.types) && options.types.length
    ? options.types
    : DEFAULT_GPU_PROCESS_TYPES;

  try {
    logger.info('Performing managed GPU memory cleanup...', { types });

    await pruneDeadManagedProcesses();

    const result = await killManagedProcesses({
      types,
      excludePid: process.pid,
      signal: 'SIGKILL',
    });

    if (result.killedCount > 0) {
      logger.info(`GPU cleanup finished: killed ${result.killedCount} managed process(es).`, {
        types,
        failed: result.failed,
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      logger.info('GPU cleanup finished: no managed processes found.', { types });
    }

    return result.killedCount;
  } catch (err) {
    logger.error('Failed to clear GPU memory', { error: String(err) });
    return 0;
  }
}

module.exports = {
  clearGpuMemory,
  DEFAULT_GPU_PROCESS_TYPES,
};