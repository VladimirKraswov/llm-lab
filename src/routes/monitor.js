const express = require('express');
const si = require('systeminformation');

const router = express.Router();

router.get('/stats', async (req, res) => {
  try {
    const [cpu, mem, gpus, disks, fsSize, network] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.graphics(),
      si.diskLayout(),
      si.fsSize(),
      si.networkStats(),
    ]);

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
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;
