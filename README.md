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

## Remote Training Architecture

Система поддерживает удаленное обучение на любых GPU-серверах через Docker.

### Основные понятия
- **Logical Base Model ID**: ID модели на Hugging Face (например, `Qwen/Qwen2.5-7B-Instruct`). Используется только для метаданных и публикации.
- **Trainer Image**: Готовый Docker-образ с "запеченной" моделью внутри. Это позволяет избежать долгого скачивания весов при каждом запуске.
- **Runtime Preset**: Пресет в UI, который связывает логический ID модели и конкретный Docker-образ.
- **Model Local Path**: Путь к весам внутри контейнера (обычно `/app`).

### Запуск удаленного обучения
1. В UI перейдите в раздел **Training**.
2. Переключите тумблер в режим **REMOTE**.
3. Выберите **Runtime Preset** (например, Qwen 2.5 7B).
4. Настройте параметры QLoRA и Hugging Face.
5. Нажмите **Start remote training**.
6. В разделе **Jobs** выберите созданную задачу.
7. Нажмите **Download Bundle** — вы получите архив с `compose.yaml` и `.env.example`.
8. Перенесите архив на GPU-сервер, настройте `HF_TOKEN` в `.env` и запустите:
   ```bash
   docker compose up
   ```

### Добавление нового Runtime Preset
Пресеты определены в `src/services/runtime-presets.js`. Чтобы добавить новый:
1. Подготовьте базовый образ с весами модели.
2. Соберите `itk-ai-trainer-service` на его основе:
   ```bash
   docker build -t your-repo/itk-ai-trainer-service:new-model --build-arg BASE_IMAGE=your-base-image -f Dockerfile.trainer .
   ```
3. Добавьте запись в `RUNTIME_PRESETS` в `src/services/runtime-presets.js`.
