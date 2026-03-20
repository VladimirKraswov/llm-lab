const { db } = require('../db');
const { uid, nowIso } = require('../utils/ids');
const crypto = require('crypto');

async function registerWorker(name, resources, labels = {}) {
  const workerId = uid('worker');
  const token = crypto.randomBytes(32).toString('hex');

  await db('workers').insert({
    id: workerId,
    name,
    status: 'online',
    token,
    resources: JSON.stringify(resources || {}),
    labels: JSON.stringify(labels || {}),
    last_heartbeat: nowIso(),
  });

  return { id: workerId, token };
}

async function heartbeat(workerId, status, resources) {
  const patch = {
    status: status || 'online',
    last_heartbeat: nowIso(),
  };

  if (resources) {
    patch.resources = JSON.stringify(resources);
  }

  await db('workers').where({ id: workerId }).update(patch);
  return { ok: true };
}

async function getAvailableWorkers() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const workers = await db('workers')
    .where('last_heartbeat', '>', fiveMinutesAgo)
    .where('status', 'online');

  return workers.map(parseWorker);
}

function parseWorker(w) {
  if (!w) return null;
  return {
    ...w,
    resources: w.resources ? JSON.parse(w.resources) : {},
    labels: w.labels ? JSON.parse(w.labels) : {},
  };
}

async function getJobForWorker(workerId) {
  const { getJobById, parseJob } = require('./jobs');

  // Find jobs assigned specifically to this worker or unassigned ones
  const job = await db('jobs')
    .where({ status: 'queued', mode: 'remote' })
    .andWhere(function() {
      this.where({ worker_id: workerId }).orWhereNull('worker_id');
    })
    .orderBy('created_at', 'asc')
    .first();

  if (job) {
    await db('jobs').where({ id: job.id }).update({
      status: 'assigned',
      worker_id: workerId,
      updated_at: nowIso(),
    });
    return parseJob(job);
  }

  return null;
}

module.exports = {
  registerWorker,
  heartbeat,
  getAvailableWorkers,
  getJobForWorker,
};
