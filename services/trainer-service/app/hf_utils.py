import os
from typing import Optional

from huggingface_hub import login


def get_hf_token() -> Optional[str]:
    return (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
    )


def try_hf_login() -> bool:
    token = get_hf_token()
    if token:
        login(token=token, add_to_git_credential=False)
        print("==> Hugging Face login success")
        return True

    print("==> HF_TOKEN not set, skip HF login")
    return False