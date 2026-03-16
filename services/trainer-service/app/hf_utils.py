import os
from huggingface_hub import login


def try_hf_login() -> None:
    token = os.environ.get("HF_TOKEN")
    if token:
        login(token=token, add_to_git_credential=False)
        print("==> Hugging Face login success")
    else:
        print("==> HF_TOKEN not set, skip HF login")