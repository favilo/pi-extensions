#!/usr/bin/env python3
"""Validate cross-artifact consistency for one local epic capsule."""

from pathlib import Path
import argparse
import re
import sys

import yaml

VALID_DELTAS = {"ADDED", "MODIFIED", "REMOVED", "RENAMED"}
VALID_RISKS = {"P0", "P1", "P2", "P3"}


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf8")) or {}


def validate(capsule: Path) -> tuple[list[str], list[str], list[str]]:
    critical: list[str] = []
    high: list[str] = []
    medium: list[str] = []
    manifest_path = capsule / "epic.yaml"

    if not manifest_path.is_file():
        return [f"missing {manifest_path}"], high, medium

    manifest = load_yaml(manifest_path)
    stories = manifest.get("stories") or []
    if not stories:
        critical.append("epic manifest has no stories")

    bcp_total = 0
    for story in stories:
        story_id = story.get("id")
        bcp_total += story.get("bcps", 0)
        spec_path = capsule / str(story.get("spec", ""))
        tasks_path = capsule / str(story.get("tasks", ""))

        if story.get("delta") not in VALID_DELTAS:
            high.append(f"{story_id}: invalid or missing delta")

        validate_spec(story, spec_path, critical, high)
        validate_tasks(story, tasks_path, critical, high, medium)

    if bcp_total != manifest.get("total_bcps"):
        high.append(
            f"epic BCP total {manifest.get('total_bcps')} does not equal story sum {bcp_total}"
        )

    return critical, high, medium


def validate_spec(
    story: dict,
    path: Path,
    critical: list[str],
    high: list[str],
) -> None:
    story_id = story.get("id")
    if not path.is_file():
        critical.append(f"{story_id}: missing spec {path.name}")
        return

    text = path.read_text(encoding="utf8")
    sections = {int(value) for value in re.findall(r"^## (\d+)\.", text, re.MULTILINE)}
    missing_sections = sorted(set(range(1, 21)) - sections)
    if missing_sections:
        high.append(f"{story_id}: missing numbered sections {missing_sections}")
    if "## 17. Acceptance criteria" not in text:
        high.append(f"{story_id}: missing acceptance criteria")
    if story.get("delta") == "MODIFIED" and not (
        "**Before:**" in text and "**After:**" in text
    ):
        critical.append(f"{story_id}: MODIFIED delta lacks before/after")


def validate_tasks(
    story: dict,
    path: Path,
    critical: list[str],
    high: list[str],
    medium: list[str],
) -> None:
    story_id = story.get("id")
    if not path.is_file():
        critical.append(f"{story_id}: missing tasks {path.name}")
        return

    task_file = load_yaml(path)
    if task_file.get("story_id") != story_id:
        critical.append(f"{story_id}: task file story_id mismatch")
    if task_file.get("bcps") != story.get("bcps"):
        high.append(f"{story_id}: task/manifest BCP mismatch")
    file_status = task_file.get("status")
    if file_status not in {"failing", "passing"}:
        high.append(f"{story_id}: task file status must be failing or passing")

    task_statuses: list[str] = []
    for task in task_file.get("tasks") or []:
        label = f"{story_id}/task-{task.get('id')}"
        if not str(task.get("verify", "")).strip():
            critical.append(f"{label}: missing verify command")
        task_status = task.get("status")
        task_statuses.append(task_status)
        if task_status not in {"failing", "passing"}:
            high.append(f"{label}: task status must be failing or passing")
        if task.get("risk") not in VALID_RISKS:
            high.append(f"{label}: invalid or missing risk")
        allure = task.get("allure") or {}
        if not allure.get("severity") or not allure.get("categories"):
            medium.append(f"{label}: incomplete allure metadata")

    if file_status == "passing" and any(status != "passing" for status in task_statuses):
        high.append(f"{story_id}: passing task file contains non-passing tasks")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("capsule", type=Path)
    args = parser.parse_args()

    critical, high, medium = validate(args.capsule)
    for level, findings in (
        ("CRITICAL", critical),
        ("HIGH", high),
        ("MED", medium),
    ):
        for finding in findings:
            print(f"{level}: {finding}")

    if critical or high:
        return 1
    print("PASS: capsule artifacts are consistent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
