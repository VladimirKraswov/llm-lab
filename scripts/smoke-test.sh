#!/usr/bin/env bash
set -euo pipefail

# Smoke test для remote flow.
#
# Что проверяет:
# 1. backend отвечает
# 2. логин работает
# 3. создаётся remote job
# 4. launch-command генерируется
# 5. bootstrap config читается через JWT
# 6. bootstrap payload содержит callback token и reporting urls
# 7. fake status/progress/final callbacks доходят
# 8. job обновляется после callback'ов
#
# Нужны:
# - curl
# - jq
#
# ENV:
#   API_BASE=http://localhost:8787
#   LOGIN=admin
#   PASSWORD=admin
#   DATASET_ID=<existing dataset id>

API_BASE="${API_BASE:-http://localhost:8787}"
LOGIN="${LOGIN:-admin}"
PASSWORD="${PASSWORD:-admin}"
DATASET_ID="${DATASET_ID:-}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

echo "==> health check"
curl -fsS "${API_BASE}/health" | jq .

echo "==> login"
TOKEN="$(
  curl -fsS \
    -X POST "${API_BASE}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg login "$LOGIN" --arg password "$PASSWORD" '{login:$login,password:$password}')" \
    | jq -r '.token'
)"

if [[ -z "${TOKEN}" || "${TOKEN}" == "null" ]]; then
  echo "failed to get auth token"
  exit 1
fi

echo "==> token received"

if [[ -z "${DATASET_ID}" ]]; then
  echo "==> DATASET_ID not provided, trying to pick first dataset"
  DATASET_ID="$(
    curl -fsS \
      -H "Authorization: Bearer ${TOKEN}" \
      "${API_BASE}/datasets" \
      | jq -r '.[0].id // empty'
  )"
fi

if [[ -z "${DATASET_ID}" ]]; then
  echo "dataset id is required and no datasets were found"
  exit 1
fi

echo "==> using dataset: ${DATASET_ID}"

CREATE_PAYLOAD="$(
  jq -nc \
    --arg datasetId "${DATASET_ID}" \
    --arg name "remote-smoke-test" \
    '{
      datasetId: $datasetId,
      name: $name,
      type: "remote-train",
      qlora: {
        maxSeqLength: 512,
        perDeviceTrainBatchSize: 1,
        gradientAccumulationSteps: 1,
        numTrainEpochs: 1,
        learningRate: 0.0002,
        loraR: 8,
        loraAlpha: 16,
        loraDropout: 0,
        loadIn4bit: true,
        targetModules: ["q_proj","k_proj","v_proj","o_proj"]
      }
    }'
)"

echo "==> creating remote job"
JOB_JSON="$(
  curl -fsS \
    -X POST "${API_BASE}/jobs/remote-train" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "${CREATE_PAYLOAD}"
)"

echo "${JOB_JSON}" | jq .

JOB_ID="$(echo "${JOB_JSON}" | jq -r '.id // .jobId // empty')"

if [[ -z "${JOB_ID}" ]]; then
  echo "failed to get job id"
  exit 1
fi

echo "==> job id: ${JOB_ID}"

echo "==> reading launch command"
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/jobs/${JOB_ID}/launch-command" \
  | jq .

echo "==> reading job details"
JOB_DETAILS="$(
  curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    "${API_BASE}/jobs/${JOB_ID}"
)"

echo "${JOB_DETAILS}" | jq .

JOB_CONFIG_URL="$(echo "${JOB_DETAILS}" | jq -r '.jobConfigUrl // empty')"

if [[ -z "${JOB_CONFIG_URL}" ]]; then
  echo "jobConfigUrl is missing"
  exit 1
fi

echo "==> jobConfigUrl: ${JOB_CONFIG_URL}"

echo "==> reading bootstrap config via JWT"
BOOTSTRAP_JSON="$(
  curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    "${API_BASE}/jobs/${JOB_ID}/config"
)"

echo "${BOOTSTRAP_JSON}" | jq .

BOOTSTRAP_TOKEN="$(echo "${BOOTSTRAP_JSON}" | jq -r '.callback_auth_token // empty')"
BOOTSTRAP_JOB_ID="$(echo "${BOOTSTRAP_JSON}" | jq -r '.job_id // empty')"
BOOTSTRAP_JOB_NAME="$(echo "${BOOTSTRAP_JSON}" | jq -r '.job_name // empty')"
TRAIN_URL="$(echo "${BOOTSTRAP_JSON}" | jq -r '.config.dataset.train_url // empty')"
STATUS_URL="$(echo "${BOOTSTRAP_JSON}" | jq -r '.config.reporting.status.url // empty')"
PROGRESS_URL="$(echo "${BOOTSTRAP_JSON}" | jq -r '.config.reporting.progress.url // empty')"
FINAL_URL="$(echo "${BOOTSTRAP_JSON}" | jq -r '.config.reporting.final.url // empty')"

if [[ -z "${BOOTSTRAP_TOKEN}" ]]; then
  echo "callback_auth_token is missing"
  exit 1
fi

if [[ -z "${STATUS_URL}" || -z "${PROGRESS_URL}" || -z "${FINAL_URL}" ]]; then
  echo "bootstrap payload does not contain reporting urls"
  exit 1
fi

if [[ -z "${TRAIN_URL}" ]]; then
  echo "bootstrap payload does not contain dataset train_url"
  exit 1
fi

if [[ "${BOOTSTRAP_JOB_ID}" != "${JOB_ID}" ]]; then
  echo "bootstrap job_id mismatch: expected ${JOB_ID}, got ${BOOTSTRAP_JOB_ID}"
  exit 1
fi

echo "==> bootstrap token received"
echo "==> bootstrap job name: ${BOOTSTRAP_JOB_NAME}"
echo "==> train url: ${TRAIN_URL}"
echo "==> status url: ${STATUS_URL}"
echo "==> progress url: ${PROGRESS_URL}"
echo "==> final url: ${FINAL_URL}"

echo "==> verifying train dataset url with callback token"
curl -fsS \
  -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
  "${TRAIN_URL}" \
  | head -n 3 || true

echo
echo "==> sending fake status callback"
curl -fsS \
  -X POST "${STATUS_URL}" \
  -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(jq -nc \
      --arg job_id "${JOB_ID}" \
      --arg job_name "${BOOTSTRAP_JOB_NAME}" \
      '{
        job_id: $job_id,
        job_name: $job_name,
        event: "status",
        status: "running",
        stage: "bootstrap",
        progress: 1,
        message: "smoke test status"
      }'
    )" \
  | jq .

echo "==> sending fake progress callback"
curl -fsS \
  -X POST "${PROGRESS_URL}" \
  -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(jq -nc \
      --arg job_id "${JOB_ID}" \
      --arg job_name "${BOOTSTRAP_JOB_NAME}" \
      '{
        job_id: $job_id,
        job_name: $job_name,
        event: "progress",
        status: "running",
        stage: "training",
        progress: 12.5,
        message: "smoke test progress",
        extra: {step: 1, loss: 1.234}
      }'
    )" \
  | jq .

echo "==> sending fake final callback"
curl -fsS \
  -X POST "${FINAL_URL}" \
  -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(jq -nc \
      --arg job_id "${JOB_ID}" \
      --arg job_name "${BOOTSTRAP_JOB_NAME}" \
      '{
        job_id: $job_id,
        job_name: $job_name,
        event: "final",
        status: "finished",
        result: {
          status: "success",
          job_id: $job_id,
          job_name: $job_name,
          training: {
            summary: {
              train_loss: 1.111,
              final_loss: 1.000
            }
          },
          evaluation: null,
          uploads: {}
        }
      }'
    )" \
  | jq .

echo "==> reading updated job"
UPDATED_JOB="$(
  curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    "${API_BASE}/jobs/${JOB_ID}"
)"

echo "${UPDATED_JOB}" | jq .

UPDATED_STATUS="$(echo "${UPDATED_JOB}" | jq -r '.status // empty')"
UPDATED_STAGE="$(echo "${UPDATED_JOB}" | jq -r '.currentStage // empty')"

if [[ "${UPDATED_STATUS}" != "completed" ]]; then
  echo "job status is not completed after final callback: ${UPDATED_STATUS}"
  exit 1
fi

echo "==> reading job events"
curl -fsS \
  -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/jobs/${JOB_ID}/events" \
  | jq .

echo "==> smoke test completed"
echo "==> final job status: ${UPDATED_STATUS}"
echo "==> final job stage: ${UPDATED_STAGE}"