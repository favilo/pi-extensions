#!/usr/bin/env python3
"""Reject committed absolute paths that identify a user's home directory."""

from pathlib import Path
import re
import subprocess
import sys

HOME_PATH_PATTERNS = (
    re.compile(r"/home/[A-Za-z0-9._-]+/"),
    re.compile(r"/Users/[A-Za-z0-9._-]+/"),
    re.compile(r"[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\"),
)


def tracked_paths() -> list[Path]:
    output = subprocess.check_output(["git", "ls-files", "-z"])
    return [Path(value.decode()) for value in output.split(b"\0") if value]


def main() -> int:
    findings: list[str] = []
    for path in tracked_paths():
        data = path.read_bytes()
        if b"\0" in data:
            continue
        text = data.decode("utf-8", errors="replace")
        for line_number, line in enumerate(text.splitlines(), start=1):
            if any(pattern.search(line) for pattern in HOME_PATH_PATTERNS):
                findings.append(f"{path}:{line_number}")

    if findings:
        print("Committed absolute user-home paths found:", file=sys.stderr)
        print("\n".join(findings), file=sys.stderr)
        print("Use ${HOME}, $HOME, or ~ instead.", file=sys.stderr)
        return 1

    print("PASS: no committed absolute user-home paths")
    return 0


if __name__ == "__main__":
    sys.exit(main())
