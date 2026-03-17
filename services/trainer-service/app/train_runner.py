from pathlib import Path
import json
import os

os.environ["WANDB_DISABLED"] = "true"

from unsloth import FastLanguageModel
import torch
from datasets import load_dataset
from transformers import TrainingArguments
from trl import SFTTrainer


def ensure_dirs(cfg) -> None:
    for path in [
        cfg.outputs.base_dir,
        cfg.outputs.logs_dir,
        cfg.outputs.lora_dir,
        cfg.outputs.checkpoints_dir,
        cfg.outputs.metrics_dir,
        cfg.outputs.merged_dir,
        cfg.outputs.quantized_dir,
    ]:
        Path(path).mkdir(parents=True, exist_ok=True)


def resolve_model_args(cfg):
    method = cfg.training.method

    if cfg.model.source == "local":
        model_name = cfg.model.local_path
    else:
        model_name = cfg.model.repo_id

    if not model_name:
        raise ValueError("Model path/repo_id is empty")

    load_in_4bit = method == "qlora"

    return model_name, load_in_4bit


def format_example(example, input_field: str, output_field: str, eos_token: str):
    return {
        "text": (
            f"### Instruction:\n{example[input_field]}\n\n"
            f"### Response:\n{example[output_field]}{eos_token}"
        )
    }


def run_training(cfg) -> dict:
    ensure_dirs(cfg)

    model_name, load_in_4bit = resolve_model_args(cfg)

    print(f"==> loading model: {model_name}")
    print(f"==> method: {cfg.training.method}")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=model_name,
        max_seq_length=cfg.training.max_seq_length,
        dtype=torch.bfloat16 if cfg.training.bf16 else None,
        load_in_4bit=load_in_4bit,
        local_files_only=(cfg.model.source == "local"),
        trust_remote_code=cfg.model.trust_remote_code,
        device_map="auto",
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=cfg.lora.r,
        target_modules=cfg.lora.target_modules,
        lora_alpha=cfg.lora.lora_alpha,
        lora_dropout=cfg.lora.lora_dropout,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
    )

    if not cfg.dataset.train_path or not cfg.dataset.val_path:
        raise ValueError("train_path and val_path are required for training")

    print("==> loading dataset")
    dataset = load_dataset(
        "json",
        data_files={
            "train": cfg.dataset.train_path,
            "validation": cfg.dataset.val_path,
        },
    )

    dataset = dataset.map(
        lambda example: format_example(
            example,
            cfg.dataset.input_field,
            cfg.dataset.output_field,
            tokenizer.eos_token,
        )
    )

    checkpoint_dir = str(Path(cfg.outputs.checkpoints_dir) / cfg.job_name)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        dataset_text_field="text",
        max_seq_length=cfg.training.max_seq_length,
        packing=cfg.training.packing,
        args=TrainingArguments(
            per_device_train_batch_size=cfg.training.per_device_train_batch_size,
            gradient_accumulation_steps=cfg.training.gradient_accumulation_steps,
            warmup_ratio=cfg.training.warmup_ratio,
            num_train_epochs=cfg.training.num_train_epochs,
            learning_rate=cfg.training.learning_rate,
            bf16=cfg.training.bf16,
            logging_steps=cfg.training.logging_steps,
            save_steps=cfg.training.save_steps,
            eval_steps=cfg.training.eval_steps,
            eval_strategy="steps",
            save_strategy="steps",
            output_dir=checkpoint_dir,
            optim="adamw_8bit",
            report_to=[],
            push_to_hub=False,
        ),
    )

    print("==> training started")
    train_result = trainer.train()
    print("==> training finished")

    lora_dir = Path(cfg.outputs.lora_dir) / cfg.job_name
    merged_dir = Path(cfg.outputs.merged_dir) / cfg.job_name
    metrics_path = Path(cfg.outputs.metrics_dir) / f"{cfg.job_name}.train_metrics.json"

    lora_dir.mkdir(parents=True, exist_ok=True)
    merged_dir.mkdir(parents=True, exist_ok=True)

    print(f"==> saving lora adapters to {lora_dir}")
    model.save_pretrained(str(lora_dir))
    tokenizer.save_pretrained(str(lora_dir))

    if cfg.postprocess.merge_lora and cfg.postprocess.save_merged_16bit:
        print(f"==> saving merged model to {merged_dir}")
        model.save_pretrained_merged(
            save_directory=str(merged_dir),
            tokenizer=tokenizer,
            save_method="merged_16bit",
        )

    metrics = dict(train_result.metrics)
    with metrics_path.open("w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)

    return {
        "status": "success",
        "job_name": cfg.job_name,
        "lora_dir": str(lora_dir),
        "merged_dir": str(merged_dir),
        "checkpoint_dir": checkpoint_dir,
        "metrics_path": str(metrics_path),
    }