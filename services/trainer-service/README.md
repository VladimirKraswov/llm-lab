# itk-ai-trainer-service

Сервис обучения моделей для LLM Lab.

Работает по одному JSON-конфигу и может запускаться:
- локально;
- удалённо.

## Что делает

Pipeline:
1. Загружает JSON-конфиг из файла или URL.
2. Логинится в Hugging Face по `HF_TOKEN`, если токен передан.
3. Загружает базовую модель.
4. Запускает SFT + LoRA fine-tuning через Unsloth.
5. Сохраняет LoRA adapter.
6. Сохраняет merged 16-bit модель.
7. При необходимости пушит LoRA и merged model в Hugging Face.
8. Сохраняет итог в `job-result.json`.

## Режимы запуска

### 1. Auto
Сервис сам определяет источник:
- если `CONFIG_REF` начинается с `http://` или `https://`, это remote;
- иначе local.

### 2. Local
Конфиг читается как путь к файлу внутри контейнера.

### 3. Remote
Конфиг скачивается по URL.

## Build

```bash
cd services/itk-ai-trainer-service
docker build -t itk-ai-trainer-service -f docker/Dockerfile .
```

## Локальный запуск

```bash
docker run --rm --gpus all   -e HF_TOKEN=hf_xxx   -e CONFIG_SOURCE=local   -e CONFIG_REF=/configs/job.local.json   -v $(pwd)/examples:/configs   -v $(pwd)/data:/data   -v $(pwd)/output:/output   itk-ai-trainer-service
```

## Удалённый запуск

```bash
docker run --rm --gpus all   -e HF_TOKEN=hf_xxx   -e CONFIG_SOURCE=remote   -e CONFIG_REF=https://example.com/job.json   -v $(pwd)/output:/output   itk-ai-trainer-service
```

## Запуск через CLI

```bash
docker run --rm --gpus all   -e HF_TOKEN=hf_xxx   -v $(pwd)/examples:/configs   -v $(pwd)/data:/data   -v $(pwd)/output:/output   itk-ai-trainer-service   --config /configs/job.local.json
```

## Env-переменные

- `CONFIG_SOURCE=auto|local|remote`
- `CONFIG_REF=<path-or-url>`
- `HF_TOKEN=<huggingface token>`

## Структура сервиса

```text
services/itk-ai-trainer-service/
├─ app/
│  ├─ config_loader.py
│  ├─ hf_utils.py
│  ├─ runner.py
│  ├─ schemas.py
│  └─ train_runner.py
├─ docker/
│  ├─ Dockerfile
│  └─ entrypoint.sh
├─ examples/
│  ├─ job.local.json
│  └─ job.remote.json
├─ .env.local.example
├─ .env.remote.example
└─ requirements.txt
```

## Интеграция с LLM Lab backend

Backend может:
- формировать JSON сам;
- сохранять JSON локально и монтировать его в контейнер;
- публиковать JSON по URL и запускать сервис удалённо.

Единый контракт для сервиса всегда один: **один JSON-конфиг на один job**.
