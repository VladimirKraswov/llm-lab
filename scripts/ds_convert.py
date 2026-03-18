#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def load_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield line_num, json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"{path}:{line_num}: invalid JSON: {e}") from e


def dump_jsonl(path: Path, rows):
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def extract_messages(record: dict):
    messages = record.get("messages")
    if not isinstance(messages, list):
        raise ValueError("record has no messages[]")

    system_parts = []
    user_parts = []
    assistant_parts = []

    for msg in messages:
        if not isinstance(msg, dict):
            continue

        role = str(msg.get("role", "")).strip().lower()
        content = msg.get("content", "")
        if not isinstance(content, str):
            content = str(content)

        content = content.strip()
        if not content:
            continue

        if role == "system":
            system_parts.append(content)
        elif role == "user":
            user_parts.append(content)
        elif role == "assistant":
            assistant_parts.append(content)

    return system_parts, user_parts, assistant_parts


def convert_record(record: dict, include_system: bool, join_user_messages: bool):
    system_parts, user_parts, assistant_parts = extract_messages(record)

    if not user_parts:
        raise ValueError("messages[] does not contain user content")
    if not assistant_parts:
        raise ValueError("messages[] does not contain assistant content")

    if join_user_messages:
        user_text = "\n\n".join(user_parts).strip()
    else:
        user_text = user_parts[-1].strip()

    output_text = assistant_parts[-1].strip()

    if include_system and system_parts:
        instruction = "\n\n".join(system_parts + [user_text]).strip()
    else:
        instruction = user_text

    result = {
        "instruction": instruction,
        "output": output_text,
    }

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Convert JSONL records from messages format to instruction/output format"
    )
    parser.add_argument("input", help="Path to input .jsonl")
    parser.add_argument("output", help="Path to output .jsonl")
    parser.add_argument(
        "--include-system",
        action="store_true",
        help="Include system messages at the top of instruction",
    )
    parser.add_argument(
        "--last-user-only",
        action="store_true",
        help="Use only the last user message instead of joining all user messages",
    )
    parser.add_argument(
        "--skip-invalid",
        action="store_true",
        help="Skip invalid rows instead of stopping on first error",
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    converted_rows = []
    invalid_count = 0

    for line_num, record in load_jsonl(input_path):
        try:
            converted = convert_record(
                record=record,
                include_system=args.include_system,
                join_user_messages=not args.last_user_only,
            )
            converted_rows.append(converted)
        except Exception as e:
            invalid_count += 1
            if args.skip_invalid:
                print(f"[skip] line {line_num}: {e}")
                continue
            raise ValueError(f"{input_path}:{line_num}: {e}") from e

    output_path.parent.mkdir(parents=True, exist_ok=True)
    dump_jsonl(output_path, converted_rows)

    print(
        json.dumps(
            {
                "ok": True,
                "input": str(input_path),
                "output": str(output_path),
                "written": len(converted_rows),
                "skipped_invalid": invalid_count,
                "include_system": args.include_system,
                "last_user_only": args.last_user_only,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()