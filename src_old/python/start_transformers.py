import json
import sys
import torch
import traceback
from flask import Flask, request, jsonify

app = Flask(__name__)

MODEL = None
TOKENIZER = None
MODEL_ID = None


def resolve_torch_dtype(dtype_value: str):
    dtype = str(dtype_value or "auto").lower()
    if dtype == "half" or dtype == "float16":
        return torch.float16
    if dtype == "bfloat16":
        return torch.bfloat16
    if dtype == "float32" or dtype == "float":
        return torch.float32
    return "auto"


def get_model_device(model):
    try:
        return model.device
    except Exception:
        pass

    try:
        return next(model.parameters()).device
    except Exception:
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def build_prompt(messages, tokenizer):
    try:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
    except Exception:
        prompt = ""
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                prompt += f"System: {content}\n"
            elif role == "user":
                prompt += f"User: {content}\n"
            elif role == "assistant":
                prompt += f"Assistant: {content}\n"
        prompt += "Assistant: "
        return prompt


def load_model(cfg):
    global MODEL, TOKENIZER, MODEL_ID

    from transformers import AutoModelForCausalLM, AutoTokenizer

    MODEL_ID = cfg["model"]
    dtype = cfg.get("dtype", "auto")
    trust_remote_code = cfg.get("trustRemoteCode", True)
    lora_path = cfg.get("loraPath")

    print(f"Loading Transformers model: {MODEL_ID}")
    print(f"DType: {dtype}, Trust Remote Code: {trust_remote_code}")

    torch_dtype = resolve_torch_dtype(dtype)

    TOKENIZER = AutoTokenizer.from_pretrained(
        MODEL_ID,
        trust_remote_code=trust_remote_code,
    )
    if TOKENIZER.pad_token is None:
        TOKENIZER.pad_token = TOKENIZER.eos_token

    MODEL = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        device_map="auto",
        torch_dtype=torch_dtype,
        trust_remote_code=trust_remote_code,
    )

    if lora_path:
        print(f"Loading LoRA adapter from {lora_path}")
        from peft import PeftModel
        MODEL = PeftModel.from_pretrained(MODEL, lora_path)

    print("Model loaded successfully.")


@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "model": MODEL_ID,
        "provider": "transformers",
        "streaming": False,
        "experimental": True,
    })


@app.route("/v1/chat/completions", methods=["POST"])
def chat():
    global MODEL, TOKENIZER, MODEL_ID

    try:
        if MODEL is None or TOKENIZER is None:
            return jsonify({"error": "Model is not loaded"}), 500

        data = request.json or {}
        messages = data.get("messages", [])
        if not isinstance(messages, list) or not messages:
            return jsonify({"error": "messages are required"}), 400

        if bool(data.get("stream", False)):
            return jsonify({
                "error": "Streaming is not supported by the experimental transformers provider"
            }), 400

        temperature = float(data.get("temperature", 0.7))
        max_tokens = int(data.get("max_tokens", 512))

        text = build_prompt(messages, TOKENIZER)

        model_inputs = TOKENIZER([text], return_tensors="pt")
        target_device = get_model_device(MODEL)
        model_inputs = {k: v.to(target_device) for k, v in model_inputs.items()}

        with torch.no_grad():
            output_ids = MODEL.generate(
                **model_inputs,
                max_new_tokens=max_tokens,
                do_sample=temperature > 0,
                temperature=temperature if temperature > 0 else 1.0,
                pad_token_id=TOKENIZER.pad_token_id,
                eos_token_id=TOKENIZER.eos_token_id,
            )

        input_len = model_inputs["input_ids"].shape[1]
        generated_ids = output_ids[0][input_len:]
        content = TOKENIZER.decode(generated_ids, skip_special_tokens=True)

        return jsonify({
            "id": "chatcmpl-transformers",
            "object": "chat.completion",
            "model": MODEL_ID,
            "choices": [{
                "message": {"role": "assistant", "content": content},
                "index": 0,
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": int(input_len),
                "completion_tokens": int(len(generated_ids)),
                "total_tokens": int(input_len + len(generated_ids))
            }
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def main():
    if len(sys.argv) < 2:
        print("Usage: start_transformers.py <config.json>")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    port = int(cfg.get("port", 8000))

    try:
        load_model(cfg)
    except Exception:
        print("FATAL ERROR: Failed to load model")
        traceback.print_exc()
        sys.exit(1)

    print(f"Starting Transformers server on port {port}")
    app.run(host="0.0.0.0", port=port, threaded=True)


if __name__ == "__main__":
    main()