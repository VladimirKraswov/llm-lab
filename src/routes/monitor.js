const express = require('express');
const si = require('systeminformation');

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

    // Filter processes that might be using GPU (heuristic if nvidia-smi not available)
    // In a real environment with NVIDIA GPUs, we'd use si.getDynamicData or parse nvidia-smi
    const gpuProcesses = processes.list
      .filter(p => p.name.toLowerCase().includes('python') || p.name.toLowerCase().includes('vllm') || p.name.toLowerCase().includes('torch'))
      .map(p => ({
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
        cores: cpu.cpus.map(c => c.load),
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        active: mem.active,
        swaptotal: mem.swaptotal,
        swapused: mem.swapused,
      },
      gpus: gpus.controllers.map(g => ({
        model: g.model,
        vendor: g.vendor,
        vram: g.vram,
        vramUsed: g.vramUsed,
        utilizationGpu: g.utilizationGpu,
        temperatureGpu: g.temperatureGpu,
      })),
      disks: fsSize.map(f => ({
        fs: f.fs,
        type: f.type,
        size: f.size,
        used: f.used,
        available: f.available,
        use: f.use,
        mount: f.mount,
      })),
      network: network.map(n => ({
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
    const processes = await si.processes();
    const toKill = processes.list.filter(p =>
      p.name.toLowerCase().includes('python') ||
      p.name.toLowerCase().includes('vllm') ||
      p.name.toLowerCase().includes('torch')
    );

    for (const p of toKill) {
      try {
        process.kill(p.pid, 'SIGKILL');
      } catch (e) {
        // ignore
      }
    }
    res.json({ ok: true, killedCount: toKill.length });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;
