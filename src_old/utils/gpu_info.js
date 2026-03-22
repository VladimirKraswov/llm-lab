const si = require('systeminformation');

async function getGpuInfo() {
  try {
    const data = await si.graphics();
    return data.controllers.map(g => ({
      model: g.model,
      vram: Number(g.vram) || 0,
      vendor: g.vendor
    }));
  } catch {
    return [];
  }
}

module.exports = { getGpuInfo };
