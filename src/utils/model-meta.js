const fs = require('fs');
const path = require('path');

function getDirSize(dirPath) {
  let size = 0;
  const files = fs.readdirSync(dirPath);

  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(dirPath, files[i]);
    const stats = fs.statSync(filePath);

    if (stats.isFile()) {
      size += stats.size;
    } else if (stats.isDirectory()) {
      size += getDirSize(filePath);
    }
  }

  return size;
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getModelMetadata(modelPath) {
  const metadata = {
    size: 0,
    sizeHuman: 'unknown',
    quantization: 'none',
    parameters: 'unknown',
    vramEstimate: 'unknown'
  };

  if (!fs.existsSync(modelPath)) return metadata;

  try {
    metadata.size = getDirSize(modelPath);
    metadata.sizeHuman = formatSize(metadata.size);

    const configPath = path.join(modelPath, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // Try to detect quantization
      if (config.quantization_config) {
        metadata.quantization = config.quantization_config.quant_method || 'unknown';
      } else if (modelPath.toLowerCase().includes('gptq')) {
        metadata.quantization = 'gptq';
      } else if (modelPath.toLowerCase().includes('awq')) {
        metadata.quantization = 'awq';
      } else if (modelPath.toLowerCase().includes('gguf')) {
        metadata.quantization = 'gguf';
      }

      // Parameters
      if (config.num_hidden_layers && config.hidden_size) {
        // Very rough estimate: 12 * layers * hidden^2
        // Better to use actual file sizes or specific config fields if available
      }
    }

    // VRAM estimate (very rough)
    // For 16-bit: ~2GB per 1B parameters
    // For 4-bit: ~0.7GB per 1B parameters
    // Since we often don't have param count easily, we can use file size + buffer
    metadata.vramEstimate = formatSize(metadata.size * 1.2);

  } catch (err) {
    console.error('Error getting model metadata:', err);
  }

  return metadata;
}

module.exports = {
  getDirSize,
  formatSize,
  getModelMetadata
};
