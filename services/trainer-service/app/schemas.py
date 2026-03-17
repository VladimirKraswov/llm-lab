from typing import List, Literal, Optional
from pydantic import BaseModel


class ModelConfig(BaseModel):
    source: Literal["local", "huggingface"] = "local"
    local_path: Optional[str] = None
    repo_id: Optional[str] = None
    trust_remote_code: bool = False


class DatasetConfig(BaseModel):
    source: Literal["local", "url"] = "local"
    train_path: Optional[str] = None
    val_path: Optional[str] = None
    train_url: Optional[str] = None
    val_url: Optional[str] = None
    format: Literal["instruction_output"] = "instruction_output"
    input_field: str = "input"
    output_field: str = "output"


class TrainingConfig(BaseModel):
    method: Literal["lora", "qlora"] = "qlora"
    max_seq_length: int = 4096
    per_device_train_batch_size: int = 1
    gradient_accumulation_steps: int = 8
    num_train_epochs: int = 1
    learning_rate: float = 1e-4
    warmup_ratio: float = 0.03
    logging_steps: int = 1
    save_steps: int = 50
    eval_steps: int = 50
    bf16: bool = True
    packing: bool = True


class LoraConfig(BaseModel):
    r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.0
    target_modules: List[str]


class OutputsConfig(BaseModel):
    base_dir: str
    logs_dir: str
    lora_dir: str
    checkpoints_dir: str
    metrics_dir: str
    merged_dir: str
    quantized_dir: str


class PostprocessConfig(BaseModel):
    merge_lora: bool = True
    save_merged_16bit: bool = True
    run_awq_quantization: bool = False


class UploadConfig(BaseModel):
    enabled: bool = False
    target: Literal["local", "huggingface", "url"] = "local"
    repo_id_lora: Optional[str] = None
    repo_id_merged: Optional[str] = None
    upload_url: Optional[str] = None


class JobConfig(BaseModel):
    job_name: str
    mode: Literal["local", "remote"] = "local"
    model: ModelConfig
    dataset: DatasetConfig
    training: TrainingConfig
    lora: LoraConfig
    outputs: OutputsConfig
    postprocess: PostprocessConfig
    upload: UploadConfig
    report_url: Optional[str] = None