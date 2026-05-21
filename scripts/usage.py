#!/usr/bin/env python3
"""Scan ~/.claude/projects/**/*.jsonl and emit a single-line JSON summary of
Claude Code token usage for (a) the active 5-hour rolling block and (b) the
last 7 days. Designed to be called by the Cinnamon applet."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from glob import glob
from pathlib import Path

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", Path.home() / ".claude"))
PROJECTS_DIR = CLAUDE_HOME / "projects"

BLOCK_HOURS = 5
WEEK_DAYS = 7

# Cost-proportional weights relative to input_tokens (Anthropic Opus pricing
# ratios: cache writes 1.25x, cache reads 0.1x, output 5x). Used to produce a
# "weighted" token count that tracks rate-limit / cost pressure more honestly
# than a raw sum, where cache_read tokens dominate.
W_INPUT = 1.0
W_CACHE_CREATE = 1.25
W_CACHE_READ = 0.1
W_OUTPUT = 5.0

DEFAULT_LIMIT_5H = 8_000_000
DEFAULT_LIMIT_WEEK = 50_000_000


def parse_ts(s: str) -> datetime | None:
    if not s:
        return None
    try:
        # Claude writes ISO 8601 with trailing Z.
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def iter_usage_records():
    """Yield (timestamp, model, raw_tokens, weighted_tokens) for every
    assistant turn across all session logs. Silently skips malformed lines."""
    pattern = str(PROJECTS_DIR / "*" / "*.jsonl")
    for path in glob(pattern):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    if rec.get("type") != "assistant":
                        continue
                    msg = rec.get("message") or {}
                    usage = msg.get("usage") or {}
                    if not usage:
                        continue
                    ts = parse_ts(rec.get("timestamp"))
                    if ts is None:
                        continue
                    inp = int(usage.get("input_tokens") or 0)
                    cc = int(usage.get("cache_creation_input_tokens") or 0)
                    cr = int(usage.get("cache_read_input_tokens") or 0)
                    out = int(usage.get("output_tokens") or 0)
                    raw = inp + cc + cr + out
                    if raw <= 0:
                        continue
                    weighted = int(
                        inp * W_INPUT
                        + cc * W_CACHE_CREATE
                        + cr * W_CACHE_READ
                        + out * W_OUTPUT
                    )
                    model = msg.get("model") or "unknown"
                    yield ts, model, raw, weighted
        except OSError:
            continue


def compute(records, now: datetime, limit_5h: int, limit_week: int) -> dict:
    records.sort(key=lambda r: r[0])
    block_window = timedelta(hours=BLOCK_HOURS)
    week_window = timedelta(days=WEEK_DAYS)
    week_since = now - week_window

    block_start: datetime | None = None
    block_raw = 0
    block_weighted = 0
    block_by_model: dict[str, dict[str, int]] = {}

    week_raw = 0
    week_weighted = 0
    week_by_model: dict[str, dict[str, int]] = {}

    last_ts: datetime | None = None
    cur_start: datetime | None = None
    cur_raw = 0
    cur_weighted = 0
    cur_by_model: dict[str, dict[str, int]] = {}

    def bump(d: dict[str, dict[str, int]], model: str, raw: int, weighted: int) -> None:
        entry = d.setdefault(model, {"raw": 0, "weighted": 0})
        entry["raw"] += raw
        entry["weighted"] += weighted

    for ts, model, raw, weighted in records:
        if ts >= week_since:
            week_raw += raw
            week_weighted += weighted
            bump(week_by_model, model, raw, weighted)
        new_block = (
            cur_start is None
            or (ts - cur_start) >= block_window
            or (last_ts is not None and (ts - last_ts) >= block_window)
        )
        if new_block:
            cur_start = ts
            cur_raw = 0
            cur_weighted = 0
            cur_by_model = {}
        cur_raw += raw
        cur_weighted += weighted
        bump(cur_by_model, model, raw, weighted)
        last_ts = ts
        block_start = cur_start
        block_raw = cur_raw
        block_weighted = cur_weighted
        block_by_model = {m: dict(v) for m, v in cur_by_model.items()}

    active = False
    reset_at: datetime | None = None
    if block_start is not None and last_ts is not None:
        if (now - block_start) < block_window:
            active = True
            reset_at = block_start + block_window
        else:
            block_start = None
            block_raw = 0
            block_weighted = 0
            block_by_model = {}

    return {
        "generated_at": now.isoformat(),
        "block": {
            "active": active,
            "start": block_start.isoformat() if block_start else None,
            "reset_at": reset_at.isoformat() if reset_at else None,
            "raw": block_raw,
            "weighted": block_weighted,
            "by_model": block_by_model,
        },
        "week": {
            "since": week_since.isoformat(),
            "raw": week_raw,
            "weighted": week_weighted,
            "by_model": week_by_model,
        },
        "limit_5h": limit_5h,
        "limit_week": limit_week,
    }


def main() -> int:
    try:
        limit_5h = int(os.environ.get("CLAUDE_LIMIT_5H", DEFAULT_LIMIT_5H))
    except ValueError:
        limit_5h = DEFAULT_LIMIT_5H
    try:
        limit_week = int(os.environ.get("CLAUDE_LIMIT_WEEK", DEFAULT_LIMIT_WEEK))
    except ValueError:
        limit_week = DEFAULT_LIMIT_WEEK

    now = datetime.now(timezone.utc)
    records = list(iter_usage_records())
    result = compute(records, now, limit_5h, limit_week)
    json.dump(result, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
