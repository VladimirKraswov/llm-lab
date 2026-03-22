function normalizePipelineConfig(configInput) {
  const config = deepClone(configInput);

  const training = asObject(config.training, {});
  const postprocess = asObject(config.postprocess, {});
  const evaluation = asObject(config.evaluation, {});
  const upload = asObject(config.upload, {});
  const huggingface = asObject(config.huggingface, {});
  const pipeline = asObject(config.pipeline, {});

  const trainingStage = asObject(pipeline.training, {});
  const mergeStage = asObject(pipeline.merge, {});
  const evaluationStage = asObject(pipeline.evaluation, {});
  const publishStage = asObject(pipeline.publish, {});
  const uploadStage = asObject(pipeline.upload, {});
  const prepareAssetsStage = asObject(pipeline.prepare_assets, {});

  const evaluationDataset =
    evaluationStage.dataset && typeof evaluationStage.dataset === 'object' && !Array.isArray(evaluationStage.dataset)
      ? deepClone(evaluationStage.dataset)
      : (
          evaluation.dataset && typeof evaluation.dataset === 'object' && !Array.isArray(evaluation.dataset)
            ? deepClone(evaluation.dataset)
            : undefined
        );

  config.pipeline = {
    prepare_assets: {
      enabled: prepareAssetsStage.enabled !== false,
    },
    training: {
      ...training,
      ...trainingStage,
      enabled: trainingStage.enabled !== false,
    },
    merge: {
      ...postprocess,
      ...mergeStage,
      enabled: mergeStage.enabled !== false,
    },
    evaluation: {
      ...evaluation,
      ...evaluationStage,
      ...(evaluationDataset ? { dataset: evaluationDataset } : {}),
      enabled:
        evaluationStage.enabled != null
          ? Boolean(evaluationStage.enabled)
          : Boolean(evaluation.enabled),
    },
    publish: {
      ...huggingface,
      ...publishStage,
      enabled:
        publishStage.enabled != null
          ? Boolean(publishStage.enabled)
          : Boolean(huggingface.enabled),
    },
    upload: {
      ...upload,
      ...uploadStage,
      auth: {
        ...asObject(upload.auth, {}),
        ...asObject(uploadStage.auth, {}),
      },
      url_targets: {
        ...asObject(upload.url_targets, {}),
        ...asObject(uploadStage.url_targets, {}),
      },
      enabled:
        uploadStage.enabled != null
          ? Boolean(uploadStage.enabled)
          : Boolean(upload.enabled),
    },
  };

  return config;
}

function ensureTrainerConfigBase(rawConfig, jobId, jobName) {
  let config = deepClone(rawConfig);

  config.job_id = jobId;
  config.job_name = String(jobName || config.job_name || jobId).trim();
  config.mode = 'remote';

  config.outputs = asObject(config.outputs, {});
  config.outputs.base_dir = `/output/${jobId}`;

  config.reporting = asObject(config.reporting, {});
  config.upload = asObject(config.upload, {});
  config.upload.auth = asObject(config.upload.auth, {});
  config.upload.url_targets = asObject(config.upload.url_targets, {});
  config.huggingface = asObject(config.huggingface, {});
  config.evaluation = asObject(config.evaluation, {});
  config.training = asObject(config.training, {});
  config.postprocess = asObject(config.postprocess, {});
  config.pipeline = asObject(config.pipeline, {});

  config = normalizePipelineConfig(config);

  return config;
}