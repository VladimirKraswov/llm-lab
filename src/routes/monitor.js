const express = require('express');
const si = require('systeminformation');
const { clearGpuMemory } = require('../utils/gpu');

const router = express.Router();

router.get('/stats', async (req, res) => {
  try {
    const [cpu, mem, gpus, disks, fsSize, network, processes] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.graphics(),
      si.diskLayout(),
      si.fsSize(),
      si.networkStats(),
      si.processes(),
    ]);

    const gpuProcesses = processes.list
      .filter((p) => p.name.toLowerCase().includes('python') || p.name.toLowerCase().includes('vllm') || p.name.toLowerCase().includes('torch'))
      .map((p) => ({
        pid: p.pid,
        name: p.name,
        cpu: p.cpu,
        mem: p.mem,
        user: p.user,
        command: p.command,
      }));

    res.json({
      cpu: {
        load: cpu.currentLoad,
        cores: cpu.cpus.map((c) => c.load),
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        active: mem.active,
        swaptotal: mem.swaptotal,
        swapused: mem.swapused,
      },
      gpus: gpus.controllers.map((g) => {
        const vram = Number(g.vram) || 0;
        const vramUsed = Number(g.vramUsed ?? g.memoryUsed ?? 0) || 0;
        const utilizationGpu = Number(g.utilizationGpu) || 0;
        const temperatureGpu = Number(g.temperatureGpu) || 0;

        return {
          model: g.model,
          vendor: g.vendor,
          vram,
          vramUsed,
          utilizationGpu,
          temperatureGpu,
        };
      }),
      disks: fsSize.map((f) => ({
        fs: f.fs,
        type: f.type,
        size: f.size,
        used: f.used,
        available: f.available,
        use: f.use,
        mount: f.mount,
      })),
      network: network.map((n) => ({
        iface: n.iface,
        operstate: n.operstate,
        rx_sec: n.rx_sec,
        tx_sec: n.tx_sec,
      })),
      gpuProcesses,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/kill', async (req, res) => {
  try {
    const { pid } = req.body;
    if (!pid) return res.status(400).json({ error: 'PID is required' });
    process.kill(pid, 'SIGKILL');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/clear-gpu', async (req, res) => {
  try {
    const killedCount = await clearGpuMemory();
    res.json({ ok: true, killedCount });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;