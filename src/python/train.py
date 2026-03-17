import json
import os
import sys
import time
from datetime import timedelta

import torch
import unsloth
from datasets import load_dataset
from unsloth import FastLanguageModel
from transformers import TrainingArguments
from trl import SFTTrainer


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: train.py <config.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    os.makedirs(cfg["outputDir"], exist_ok=True)

    wandb_cfg = cfg.get("wandb", {}) or {}
    wandb_enabled = bool(wandb_cfg.get("enabled")) and wandb_cfg.get("mode", "online") != "disabled"

    if wandb_cfg.get("mode") == "offline":
        os.environ["WANDB_MODE"] = "offline"

    if wandb_cfg.get("baseUrl"):
        os.environ["WANDB_BASE_URL"] = wandb_cfg["baseUrl"]

    if wandb_enabled:
        import wandb
        if wandb_cfg.get("apiKey"):
            wandb.login(key=wandb_cfg["apiKey"])
        wandb.init(
            project=wandb_cfg.get("project", "llm-lab"),
            entity=wandb_cfg.get("entity"),
            name=os.path.basename(cfg["outputDir"]),
            config=cfg,
            dir=cfg["outputDir"],
            mode=wandb_cfg.get("mode", "online"),
        )

    # ---------- Включаем expandable segments для уменьшения фрагментации ----------
    os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

    # Загрузка модели через Unsloth (без BitsAndBytesConfig, только load_in_4bit)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=cfg["baseModel"],
        max_seq_length=cfg["qlora"]["maxSeqLength"],
        load_in_4bit=cfg["qlora"]["loadIn4bit"],   # True
        trust_remote_code=True,
        device_map="auto",
        max_memory={0: "28GB", "cpu": "12GB"},     # оставляем запас
    )

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    use_lora = cfg["qlora"].get("useLora", True)

    if use_lora:
        model = FastLanguageModel.get_peft_model(
            model,
            r=cfg["qlora"]["loraR"],
            target_modules=cfg["qlora"]["targetModules"],
            lora_alpha=cfg["qlora"]["loraAlpha"],
            lora_dropout=cfg["qlora"]["loraDropout"],
            bias="none",
            use_gradient_checkpointing="unsloth",
        )

    # Явный вызов to("cuda") не нужен

    dataset = load_dataset("json", data_files=cfg["datasetPath"], split="train")

    def format_row(row):
        messages = row.get("messages", [])
        if not isinstance(messages, list) or len(messages) < 2:
            return {"text": ""}
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    dataset = dataset.map(format_row)
    dataset = dataset.filter(lambda x: bool(x["text"] and x["text"].strip()))

    if len(dataset) == 0:
        raise ValueError("Dataset is empty after formatting/filtering")

    use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()

    args = TrainingArguments(
        output_dir=cfg["outputDir"],
        per_device_train_batch_size=cfg["qlora"]["perDeviceTrainBatchSize"],
        gradient_accumulation_steps=cfg["qlora"]["gradientAccumulationSteps"],
        learning_rate=cfg["qlora"]["learningRate"],
        num_train_epochs=cfg["qlora"]["numTrainEpochs"],
        warmup_ratio=cfg["qlora"]["warmupRatio"],
        logging_steps=1,
        save_strategy="epoch",
        save_safetensors=True,
        bf16=use_bf16,
        fp16=not use_bf16,
        report_to=["wandb"] if wandb_enabled else [],
        remove_unused_columns=False,
        group_by_length=False,
        optim="paged_adamw_8bit",   # экономит память
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        args=args,
        dataset_text_field="text",
        packing=False,
        dataset_num_proc=1,
    )

    start_time = time.time()
    train_result = trainer.train()
    end_time = time.time()

    if use_lora:
        model.save_pretrained(cfg["outputDir"])
    else:
        trainer.save_model(cfg["outputDir"])

    tokenizer.save_pretrained(cfg["outputDir"])

    duration = end_time - start_time

    metrics = train_result.metrics
    final_loss = None
    if trainer.state.log_history:
        for entry in reversed(trainer.state.log_history):
            if "loss" in entry:
                final_loss = entry["loss"]
                break

    wandb_run_id = None
    if wandb_enabled:
        try:
            import wandb
            if wandb.run:
                wandb_run_id = wandb.run.id
        except:
            pass

    summary = {
        "duration": duration,
        "duration_human": str(timedelta(seconds=int(duration))),
        "final_loss": final_loss,
        "train_runtime": metrics.get("train_runtime"),
        "train_samples_per_second": metrics.get("train_samples_per_second"),
        "train_steps_per_second": metrics.get("train_steps_per_second"),
        "total_flos": metrics.get("total_flos"),
        "train_loss": metrics.get("train_loss"),
        "rows": len(dataset),
        "bf16": use_bf16,
        "fp16": not use_bf16,
        "wandb_run_id": wandb_run_id,
    }

    with open(os.path.join(cfg["outputDir"], "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    with open(os.path.join(cfg["outputDir"], "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(trainer.state.log_history, f, indent=2)

    print(json.dumps({
        "ok": True,
        "outputDir": cfg["outputDir"],
        "summary": summary,
        "wandbEnabled": wandb_enabled,
        "wandbMode": wandb_cfg.get("mode", "online"),
    }))


if __name__ == "__main__":
    main()