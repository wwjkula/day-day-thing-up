#!/usr/bin/env python3
"""
Normalize employeeNo values for users with L*/D* prefixes so that the numeric
part matches the user id (zero-padded to at least three digits).

Usage:
    python tools/fix_employee_numbers.py

This script updates data/users.json in place and prints a summary of changes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT_PATH = Path(__file__).resolve().parent.parent
USERS_PATH = ROOT_PATH / "data" / "users.json"
PATTERN = re.compile(r"^([A-Za-z]+)(\d+)$")


def normalize_employee_numbers() -> int:
    if not USERS_PATH.exists():
        raise FileNotFoundError(f"{USERS_PATH} not found")

    data = json.loads(USERS_PATH.read_text(encoding="utf-8"))
    items = data.get("items", [])

    changes = []
    for item in items:
        employee_no = item.get("employeeNo")
        if not isinstance(employee_no, str):
            continue

        stripped = employee_no.strip()
        match = PATTERN.fullmatch(stripped)
        if not match:
            continue

        prefix, digits = match.groups()
        if not prefix or prefix[0].upper() not in {"L", "D"}:
            # Only handle prefixes that start with L or D.
            continue

        width = max(3, len(str(item.get("id", ""))))
        try:
            identifier = int(item["id"])
        except (TypeError, ValueError):
            continue

        new_employee_no = f"{prefix}{identifier:0{width}d}"
        if new_employee_no != stripped:
            item["employeeNo"] = new_employee_no
            changes.append((stripped, new_employee_no, item.get("name"), identifier))

    if changes:
        USERS_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    for old, new, name, identifier in changes:
        print(f"[updated] id={identifier:<3} name={name or '(unknown)'}: {old} -> {new}")

    if changes:
        print(f"Completed. Updated {len(changes)} employee numbers.")
    else:
        print("Completed. No employee numbers required updates.")
    return len(changes)


def main() -> None:
    normalize_employee_numbers()


if __name__ == "__main__":
    main()
