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


def is_non_empty_string(value):
    return isinstance(value, str) and value.strip() != ""


def is_instruction_output_record(record: dict) -> bool:
    return is_non_empty_string(record.get("instruction")) and is_non_empty_string(record.get("output"))


def is_messages_record(record: dict) -> bool:
    return isinstance(record.get("messages"), list)


def normalize_instruction_output_record(record: dict) -> dict:
    return {
        "instruction": str(record["instruction"]).strip(),
        "output": str(record["output"]).strip(),
    }


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


def convert_messages_record(record: dict, include_system: bool, join_user_messages: bool) -> dict:
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

    return {
        "instruction": instruction,
        "output": output_text,
    }


def convert_record(record: dict, include_system: bool, join_user_messages: bool, passthrough_io: bool) -> dict:
    if not isinstance(record, dict):
        raise ValueError("row is not a JSON object")

    if is_instruction_output_record(record):
        if passthrough_io:
            return normalize_instruction_output_record(record)
        raise ValueError("instruction/output row found, but passthrough is disabled")

    if is_messages_record(record):
        return convert_messages_record(
            record=record,
            include_system=include_system,
            join_user_messages=join_user_messages,
        )

    raise ValueError("unsupported row format: expected messages[] or instruction/output")


def main():
    parser = argparse.ArgumentParser(
        description="Convert mixed JSONL dataset to instruction/output format"
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
    parser.add_argument(
        "--no-passthrough-io",
        action="store_true",
        help="Fail on existing instruction/output rows instead of passing them through",
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    converted_rows = []
    invalid_count = 0
    messages_count = 0
    io_count = 0

    for line_num, record in load_jsonl(input_path):
        try:
            if is_messages_record(record):
                messages_count += 1
            elif is_instruction_output_record(record):
                io_count += 1

            converted = convert_record(
                record=record,
                include_system=args.include_system,
                join_user_messages=not args.last_user_only,
                passthrough_io=not args.no_passthrough_io,
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
                "messages_rows": messages_count,
                "instruction_output_rows": io_count,
                "include_system": args.include_system,
                "last_user_only": args.last_user_only,
                "passthrough_instruction_output": not args.no_passthrough_io,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()