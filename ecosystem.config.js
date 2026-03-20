const commonEnv = {
  NODE_ENV: process.env.NODE_ENV || 'production',
  SVC_PORT: process.env.SVC_PORT || 8787,
  SVC_HOST: process.env.SVC_HOST || '0.0.0.0',
  CALLBACK_BASE_URL: process.env.CALLBACK_BASE_URL || 'http://tts.xserver-krv.ru',
  REMOTE_BAKED_MODEL_PATH: process.env.REMOTE_BAKED_MODEL_PATH || '/app',
  WORKSPACE: process.env.WORKSPACE || '/opt/deepseek-workspace',
  JWT_SECRET: process.env.JWT_SECRET || 'llm-lab-super-secret-key',
};

module.exports = {
  apps: [
    {
      name: 'llm-lab-backend',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: commonEnv,
      env_production: {
        ...commonEnv,
        NODE_ENV: 'production',
      },
      watch: false,
      autorestart: true,
      max_memory_restart: '1G',
    },
  ],
};