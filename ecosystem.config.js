module.exports = {
  apps: [
    {
      name: 'llm-lab-backend',
      script: 'src/server.js',
      env: {
        NODE_ENV: 'development',
        SVC_PORT: 8787,
        SVC_HOST: '0.0.0.0',
        CALLBACK_BASE_URL: 'http://tts.xserver-krv.ru',
        REMOTE_BAKED_MODEL_PATH: '/app',
        WORKSPACE: process.env.WORKSPACE || '/opt/deepseek-workspace',
        JWT_SECRET: process.env.JWT_SECRET || 'llm-lab-super-secret-key',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      watch: ['src'],
      ignore_watch: ['node_modules', '.llm-lab', 'logs'],
      autorestart: true,
      max_memory_restart: '1G',
    },
    {
      name: 'llm-lab-frontend',
      script: 'npm',
      args: 'run web:dev',
      env: {
        NODE_ENV: 'development',
        VITE_API_BASE: 'http://localhost:8787',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      autorestart: true,
    },
  ],
};
