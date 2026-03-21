const { CONFIG } = require('../config');

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function joinUrl(base, routePath) {
  return `${String(base || '').replace(/\/+$/, '')}${routePath}`;
}

function buildRemoteTrainerConfig({ job, dataset, callbackAuthToken, publicBaseUrl }) {
  if (!job) {
    throw new Error('job is required');
  }

  if (!dataset?.processedPath) {
    throw new Error(`dataset for job ${job.id} is missing processedPath`);
  }

  if (!callbackAuthToken) {
    throw new Error(`callbackAuthToken is required for job ${job.id}`);
  }

  const qlora = job.paramsSnapshot?.qlora || {};
  const hfPublish = job.paramsSnapshot?.hfPublish || {};
  const baseDir = `/output/${job.id}`;

  const callbackBaseUrl = String(publicBaseUrl || CONFIG.callbackBaseUrl || '').replace(/\/+$/, '');
  if (!callbackBaseUrl) {
    throw new Error('callbackBaseUrl is empty');
  }

  const logicalBaseModelId = String(job.baseModel || '').trim();

  if (
    hfPublish.enabled &&
    (!logicalBaseModelId || logicalBaseModelId.startsWith('/'))
  ) {
    throw new Error(
      `Remote job ${job.id} has invalid baseModel for Hugging Face publish: "${logicalBaseModelId}". ` +
      `Expected HF model id like "Qwen/Qwen2.5-7B-Instruct".`
    );
  }

  const trainUrl = joinUrl(
    callbackBaseUrl,
    `/api/jobs/${job.id}/dataset/train?token=${encodeURIComponent(callbackAuthToken)}`
  );

  const reportingAuth = {
    bearer_token: callbackAuthToken,
  };

  const loadIn4bit =
    qlora.loadIn4bit !== undefined
      ? !!qlora.loadIn4bit
      : true;

  const trainerMethod = loadIn4bit ? 'qlora' : 'lora';

  // Pipeline mapping
  const pipeline = job.paramsSnapshot?.pipeline || {
    prepare_assets: { enabled: true },
    training: { enabled: true },
    merge: { enabled: !!job.paramsSnapshot?.qlora?.useLora },
    evaluation: { enabled: false },
    publish: { enabled: !!hfPublish.enabled },
    upload: { enabled: !!hfPublish.enabled },
  };

  return {
    job_id: job.id,
    job_name: job.name || job.id,
    mode: 'remote',

    model: {
      source: 'local',

      // Фактическая baked model внутри trainer container
      local_path: job.modelLocalPath || CONFIG.remoteBakedModelPath || '/app',

      // Логическая базовая модель для metadata / README / HF upload
      base_model: logicalBaseModelId,
      base_model_name_or_path: logicalBaseModelId,
      repo_id: logicalBaseModelId,

      trust_remote_code: false,
      load_in_4bit: loadIn4bit,
      dtype: 'bfloat16',
      max_seq_length: toInt(qlora.maxSeqLength, 4096),
    },

    dataset: {
      source: 'url',
      train_url: trainUrl,
      format: 'messages',
      messages_field: 'messages',
    },

    training: {
      method: trainerMethod,
      max_seq_length: toInt(qlora.maxSeqLength, 4096),
      per_device_train_batch_size: toInt(qlora.perDeviceTrainBatchSize, 1),
      gradient_accumulation_steps: toInt(qlora.gradientAccumulationSteps, 8),
      num_train_epochs: toInt(qlora.numTrainEpochs, 1),
      learning_rate: toNum(qlora.learningRate, 2e-4),
      warmup_ratio: toNum(qlora.warmupRatio, 0.03),
      logging_steps: 1,
      save_steps: 50,
      eval_steps: 50,
      bf16: true,
      packing: false,
      save_total_limit: 2,
      optim: 'adamw_8bit',
    },

    lora: {
      r: toInt(qlora.loraR, 16),
      lora_alpha: toInt(qlora.loraAlpha, 16),
      lora_dropout: toNum(qlora.loraDropout, 0),
      bias: 'none',
      use_gradient_checkpointing: 'unsloth',
      random_state: 3407,
      target_modules: Array.isArray(qlora.targetModules) && qlora.targetModules.length
        ? qlora.targetModules
        : ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
    },

    outputs: {
      base_dir: baseDir,
    },

    postprocess: {
      merge_lora: true,
      save_merged_16bit: true,
      run_awq_quantization: false,
    },

    evaluation: {
      enabled: !!pipeline.evaluation?.enabled,
      target: pipeline.evaluation?.target || 'auto',
      max_samples: toInt(pipeline.evaluation?.max_samples, null),
      max_new_tokens: toInt(pipeline.evaluation?.max_new_tokens, 128),
      temperature: toNum(pipeline.evaluation?.temperature, 0.0),
      do_sample: !!pipeline.evaluation?.do_sample,
      system_prompt: pipeline.evaluation?.system_prompt || null,
      prompt_template: pipeline.evaluation?.prompt_template || undefined,
      parsing_regex: pipeline.evaluation?.parsing_regex || null,
      score_min: toNum(pipeline.evaluation?.score_min, 0.0),
      score_max: toNum(pipeline.evaluation?.score_max, 5.0),
      dataset: pipeline.evaluation?.dataset || undefined,
    },

    reporting: {
      status: {
        enabled: true,
        url: joinUrl(callbackBaseUrl, '/api/jobs/status'),
        timeout_sec: 15,
        auth: reportingAuth,
      },
      progress: {
        enabled: true,
        url: joinUrl(callbackBaseUrl, '/api/jobs/progress'),
        timeout_sec: 15,
        auth: reportingAuth,
      },
      final: {
        enabled: true,
        url: joinUrl(callbackBaseUrl, '/api/jobs/final'),
        timeout_sec: 15,
        auth: reportingAuth,
      },
      logs: {
        enabled: true,
        url: joinUrl(callbackBaseUrl, '/api/jobs/logs'),
        timeout_sec: 15,
        auth: reportingAuth,
      },
    },

    upload: {
      enabled: !!pipeline.upload?.enabled,
      target: pipeline.upload?.enabled ? 'url' : (pipeline.publish?.enabled ? 'huggingface' : 'local'),
    },

    huggingface: {
      enabled: !!pipeline.publish?.enabled,
      push_lora: pipeline.publish?.push_lora !== undefined ? !!pipeline.publish.push_lora : !!hfPublish.push_lora,
      push_merged: pipeline.publish?.push_merged !== undefined ? !!pipeline.publish.push_merged : !!hfPublish.push_merged,
      repo_id_lora: hfPublish.repo_id_lora || '',
      repo_id_merged: hfPublish.repo_id_merged || '',
      repo_id_metadata: hfPublish.repo_id_metadata || '',
    },

    pipeline,
  };
}

module.exports = {
  buildRemoteTrainerConfig,
};