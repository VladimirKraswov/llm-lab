
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
