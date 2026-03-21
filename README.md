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

## Удаленное обучение (Remote Training)

Система поддерживает запуск обучения на любых удаленных GPU-серверах через Docker.

### Runtime Presets

Вместо выбора произвольного Docker-образа, в UI используются **Runtime Presets**.
Пресет — это фиксированная конфигурация, включающая:
- **Logical Base Model**: Идентификатор модели (например, `Qwen/Qwen2.5-7B-Instruct`), который сохраняется в метаданных и используется при публикации в Hugging Face.
- **Container Image**: Конкретный Docker-образ, оптимизированный под эту модель.
- **Model Local Path**: Путь к весам модели внутри контейнера (обычно `/app`). Это позволяет избежать копирования гигабайтов данных при каждом запуске.

### Запуск обучения на удаленном сервере

1. В разделе **Training** выберите режим **REMOTE**.
2. Выберите подходящий **Runtime Preset**.
3. Настройте параметры обучения (LoRA, датасет) и нажмите **Start Training**.
4. После создания задачи перейдите в **Job Details**.
5. Скачайте **Launch Bundle** (кнопка "Download Bundle").
6. Перенесите архив на удаленный GPU-сервер.
7. Распакуйте и запустите:
   ```bash
   tar -xzf job_bundle_ID.tar.gz
   # Отредактируйте .env (укажите HF_TOKEN для публикации)
   docker compose up -d
   ```

### Добавление новых пресетов

Пресеты определяются в файле `src/services/runtime-presets.js`. Чтобы добавить новый образ или модель, добавьте объект в массив `PRESETS`.

### Структура Bundle

- `compose.yaml`: Конфигурация Docker Compose с пробросом GPU, монтированием томов для вывода и кэша.
- `.env.example`: Шаблон переменных окружения (включая `JOB_CONFIG_URL` с токеном доступа).
- `README.txt`: Краткая инструкция по запуску.

### Agent-Based Training Architecture

The system utilizes a unified **Agent-Based** execution model for all training tasks. There is no longer a distinction between "local" and "remote" training at the backend level. Every job is handled by a **Trainer Agent**.

- **Orchestrator**: Manages the UI, API, database, and job queuing. It does not execute training directly.
- **Agent**: A small Node.js process that polls the Orchestrator for jobs, downloads the configuration, and launches a Docker container with the `trainer-service` to execute the pipeline.

To run training on the same machine as the Orchestrator, simply launch a "local agent" (e.g., using PM2 or Docker).

### Pipeline Configuration

Training jobs support a configurable **Pipeline** architecture. Instead of a hardcoded execution sequence, you can explicitly enable or disable individual stages:

- **Prepare Assets**: Downloads the dataset and required remote assets.
- **Training**: Executes the LoRA/QLoRA fine-tuning process.
- **Merge LoRA**: Merges the trained adapter into a full 16-bit model.
- **Evaluation**: Runs automated benchmarks (eval-benchmarks) on the resulting model.
- **Hugging Face Publish**: Pushes the LoRA adapter, the merged model, and metadata to Hugging Face repositories.
- **Artifact Upload**: Uploads logs, metrics, and summaries to the orchestrator via pre-configured URLs.

#### Stage Dependencies & Validation:
- **Evaluation** on a `merged` target requires the **Merge** stage to be enabled.
- **Publishing** a `merged` model requires the **Merge** stage to be enabled.
- Disabling the **Training** stage while keeping **Evaluation** enabled will trigger a warning, as evaluation might fail if weights are not pre-baked into the container image.

Each stage can be toggled in the **Training** page under the **Pipeline Configuration** section. Safely configured defaults are provided for standard training runs.

## Безопасность

`JOB_CONFIG_URL` содержит временный токен доступа к конфигурации задачи. Не передавайте этот URL третьим лицам. После завершения задачи или истечения срока действия токена доступ будет закрыт.
