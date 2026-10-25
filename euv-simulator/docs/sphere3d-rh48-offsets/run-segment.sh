#!/bin/bash
# One segment of a checkpointed 3D R/h 48 grid-offset run (docs/sphere3d-uncertainty-audit, section 5, option A).
# Usage: run-segment.sh <offset> <segment number> <RESUME 0|1> [STOP_AT step]
set -u
cd /home/user/we-do-a-little-fun/euv-simulator
OFF=$1
SEG=$2
RES=$3
STOP=${4:-}
D=<scratchpad>/rh48-offsets/off$OFF   # scratch directory of this session
TOP=docs/sphere3d-rh48-offsets
OUT=$TOP/off$OFF
mkdir -p "$D" "$OUT"
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
env RH=48 OFF=$OFF EXTRA='{"downstream":0.5,"lateral":2}' CKPT=$D/rh48.ckpt EVERY=500 BUDGET_MIN=100 OUT=$OUT RESUME=$RES \
  ${STOP:+STOP_AT=$STOP} \
  npx vitest run --root . --config /dev/null --testTimeout 14400000 scripts/sphere3d-resumable.test.ts > "$D/segment$SEG.log" 2>&1
CODE=$?
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OFF=$OFF SEG=$SEG RES=$RES STOP=$STOP START=$START END=$END CODE=$CODE D=$D TOP=$TOP node -e '
const fs = require("fs");
const e = process.env;
const st = fs.existsSync(e.D + "/rh48.ckpt.status.json") ? JSON.parse(fs.readFileSync(e.D + "/rh48.ckpt.status.json", "utf8")) : null;
const ck = fs.existsSync(e.D + "/rh48.ckpt") ? fs.statSync(e.D + "/rh48.ckpt") : null;
const rec = { offset: Number(e.OFF), segment: Number(e.SEG), resume: e.RES === "1", start: e.START, end: e.END, exitCode: Number(e.CODE),
  command: "RH=48 OFF=" + e.OFF + " EXTRA={downstream:0.5,lateral:2} EVERY=500 BUDGET_MIN=100 RESUME=" + e.RES + (e.STOP ? " STOP_AT=" + e.STOP : ""),
  checkpoint: "<scratchpad>/rh48-offsets/off" + e.OFF + "/rh48.ckpt", checkpointBytes: ck ? ck.size : null, checkpointMtime: ck ? ck.mtime.toISOString() : null, status: st };
fs.appendFileSync(e.TOP + "/segments.jsonl", JSON.stringify(rec) + "\n");
console.log(JSON.stringify(rec));'
exit $CODE
