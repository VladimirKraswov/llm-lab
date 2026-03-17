# LLM Lab Full Code

Полная заготовка для сервиса обучения LLM с отдельным web UI.

## Что внутри
- `src/` — backend на Express
- `web/` — frontend на Vite + React + TypeScript + Tailwind

## Что добавлено
- dashboard summary
- dataset preview + delete
- job details + logs
- runtime health
- runtime start from completed job output
- SSE events endpoint
- chat endpoint без shell curl

## Backend
```bash
cp env.example .env
npm install
npm run dev
```

## Frontend
```bash
cd web
npm install
npm run dev
```

## Переменные для frontend
По умолчанию UI ходит в `http://127.0.0.1:8787`.

Если нужен другой backend URL:
```bash
VITE_API_BASE=http://127.0.0.1:8787 npm run dev
```

## Развертывание через Docker Compose

Для удобного удаленного развертывания со всеми зависимостями (vLLM, Unsloth, CUDA 12.8):

1. **Подготовка**:
   Убедитесь, что у вас установлены [Docker](https://docs.docker.com/get-docker/) и [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

2. **Запуск**:
   ```bash
   docker compose up -d
   ```

3. **Доступ**:
   UI и API будут доступны на порту `8787`.

Все данные (модели, датасеты, логи) сохраняются в директорию `./workspace` на хосте.

Параметры GPU (резервирование всех доступных GPU) настроены в `docker-compose.yml`.
