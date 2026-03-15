import json
import sys
import os
import time
import torch
import traceback
from flask import Flask, request, jsonify, Response

def main():
    if len(sys.argv) < 2:
        print("Usage: start_transformers.py <config.json>")
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        cfg = json.load(f)

    model_id = cfg["model"]
    port = cfg.get("port", 8000)
    dtype = cfg.get("dtype", "auto")
    trust_remote_code = cfg.get("trustRemoteCode", True)
    lora_path = cfg.get("loraPath")

    print(f"Loading Transformers model: {model_id}")
    print(f"DType: {dtype}, Trust Remote Code: {trust_remote_code}")

    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer

        torch_dtype = torch.float16 if dtype == "half" else "auto"
        if dtype == "bfloat16":
            torch_dtype = torch.bfloat16
        elif dtype == "float32" or dtype == "float":
            torch_dtype = torch.float32

        tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=trust_remote_code)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            device_map="auto",
            torch_dtype=torch_dtype,
            trust_remote_code=trust_remote_code
        )

        if lora_path:
            print(f"Loading LoRA adapter from {lora_path}")
            from peft import PeftModel
            model = PeftModel.from_pretrained(model, lora_path)

        print("Model loaded successfully.")
    except Exception as e:
        print("FATAL ERROR: Failed to load model")
        traceback.print_exc()
        sys.exit(1) # Fail fast

    app = Flask(__name__)

    @app.route("/health")
    def health():
        return jsonify({"status": "ok", "model": model_id})

    @app.route("/v1/chat/completions", methods=["POST"])
    def chat():
        data = request.json
        messages = data.get("messages", [])
        temperature = float(data.get("temperature", 0.7))
        max_tokens = int(data.get("max_tokens", 512))
        stream = bool(data.get("stream", False))

        # Basic prompt construction (simple chat template)
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

        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

        if stream:
            def generate():
                # Extremely simplified streaming for Transformers
                # In production, use TextIteratorStreamer
                from transformers import TextIteratorStreamer
                from threading import Thread

                streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
                generation_kwargs = dict(
                    inputs,
                    streamer=streamer,
                    max_new_tokens=max_tokens,
                    do_sample=temperature > 0,
                    temperature=temperature if temperature > 0 else 1.0,
                    pad_token_id=tokenizer.pad_token_id,
                )
                thread = Thread(target=model.generate, kwargs=generation_kwargs)
                thread.start()

                for new_text in streamer:
                    if not new_text: continue
                    chunk = {
                        "choices": [{"delta": {"content": new_text}, "index": 0, "finish_reason": None}]
                    }
                    yield f"data: {json.dumps(chunk)}\n\n"

                yield "data: [DONE]\n\n"

            return Response(generate(), mimetype="text/event-stream")
        else:
            with torch.no_grad():
                output_ids = model.generate(
                    **inputs,
                    max_new_tokens=max_tokens,
                    do_sample=temperature > 0,
                    temperature=temperature if temperature > 0 else 1.0,
                    pad_token_id=tokenizer.pad_token_id,
                )

            input_len = inputs.input_ids.shape[1]
            generated_ids = output_ids[0][input_len:]
            content = tokenizer.decode(generated_ids, skip_special_tokens=True)

            return jsonify({
                "choices": [{
                    "message": {"role": "assistant", "content": content},
                    "index": 0,
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": input_len,
                    "completion_tokens": len(generated_ids),
                    "total_tokens": input_len + len(generated_ids)
                }
            })

    print(f"Starting Transformers server on port {port}")
    app.run(host="0.0.0.0", port=port, threaded=True)

if __name__ == "__main__":
    main()
