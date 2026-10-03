#!/usr/bin/env python3
"""Check a translated flat JSON catalog against en.json.

Usage: python3 validate_catalog.py en.json es-419.json
Uses only the Python standard library; does not modify either file.
Checks structure and protected syntax, not translation quality.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate key: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"Invalid JSON constant: {value}")


def load(path):
    data = json.loads(
        Path(path).read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
        parse_constant=reject_constant,
    )
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a JSON object")
    for key, value in data.items():
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{path}: {key}: expected a nonempty string")
    return data


def placeholders(text):
    return Counter(re.findall(r"\{[A-Za-z_][A-Za-z0-9_]*\}", text))


def urls(text):
    return Counter(re.findall(r"https?://[^\s<>\"']+", text))


def tags(text):
    return Counter(re.findall(r"</?[A-Za-z][^>]*>", text))


def validate(source_path, target_path):
    source = load(source_path)
    target = load(target_path)
    errors = []

    for key in sorted(source.keys() - target.keys()):
        errors.append(f"Missing key: {key}")
    for key in sorted(target.keys() - source.keys()):
        errors.append(f"Unexpected key: {key}")

    for key in sorted(source.keys() & target.keys()):
        for label, extract in [
            ("placeholders", placeholders),
            ("URLs", urls),
            ("markup tags", tags),
        ]:
            if extract(source[key]) != extract(target[key]):
                errors.append(f"{key}: mismatched {label}")

        if source[key].count("\n") != target[key].count("\n"):
            errors.append(f"{key}: mismatched line-break count")

    if errors:
        raise ValueError("\n".join(errors))

    print(f"PASS: {target_path} — {len(source)} keys validated")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError(
                "Usage: python3 validate_catalog.py en.json translated.json"
            )
        validate(sys.argv[1], sys.argv[2])
    except (ValueError, OSError, UnicodeError) as error:
        print(f"FAIL:\n{error}", file=sys.stderr)
        sys.exit(1)
