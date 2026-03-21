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

### Инфраструктура и Удаленное обучение (Infrastructure & Remote Training)

Система поддерживает полный цикл управления инфраструктурой для обучения: от каталога базовых образов до автоматической сборки тренировочных агентов и их запуска.

#### 1. Каталог Base Model Images
Это реестр существующих Docker-образов, в которые уже "запечены" веса моделей (baked models).
- **Logical Base Model ID**: Официальный ID (например, `Qwen/Qwen2.5-7B-Instruct`) для метаданных Hugging Face.
- **Docker Image**: Ссылка на образ в реестре (например, `igortet/model-qwen-7b`).
- **Model Local Path**: Путь к весам внутри контейнера (например, `/app`).

#### 2. Agent Build Recipes
Рецепты описывают, как собрать готовый к работе `trainer-agent` поверх выбранного базового образа.
- Использует `Dockerfile.trainer` с аргументом `BASE_IMAGE`.
- Автоматически подтягивает параметры из Base Model Image.
- Позволяет настроить тегирование и автоматический пуш в Docker Hub.

#### 3. Agent Builds & Runtime Presets
Конкретная сборка образа по рецепту.
- При успешном завершении сборки можно **опубликовать Runtime Preset**.
- **Runtime Preset** — это то, что конечный пользователь выбирает в интерфейсе обучения.
- Пресет гарантирует, что `logicalBaseModelId` (для HF) и `modelLocalPath` (для запуска) не перепутаются.

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

### Управление инфраструктурой в UI

Все операции доступны в разделе **Infrastructure**:
- **Base Models**: Добавление и редактирование каталога моделей.
- **Build Recipes**: Создание конфигураций для сборки.
- **Agent Builds**: Запуск сборки, просмотр логов и публикация пресетов.

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
