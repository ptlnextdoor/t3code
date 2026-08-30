#!/usr/bin/env bash
set -u
export PATH=/root/.local/bin:$PATH
OUT=/opt/t3code/side-door
mkdir -p "$OUT"
RAW="$OUT/omnigent-raw.log"
RAMLOG="$OUT/ram-samples.log"
META="$OUT/run-meta.log"
PROMPT_FILE="$OUT/prompt.txt"

cat > "$PROMPT_FILE" <<'PROMPT'
Research the current best practices for on-device screen-activity capture on macOS and Windows. This is pure public-web research: use your web search and fetch tools, cite sources with URLs. Do NOT access any personal/local data.

Cover, for macOS: ScreenCaptureKit vs CGWindowList polling (deprecation status, frame-rate/quality, permission model), battery/CPU cost of each, App Store sandboxing + TCC (Screen Recording permission) constraints, and specifically what Dayflow does per its public repo https://github.com/JerryZLiu/Dayflow (read the README and source; note its capture cadence, API choice, storage, and privacy posture). For Windows: the equivalent APIs (Windows.Graphics.Capture / Desktop Duplication API / GDI BitBlt), their tradeoffs and permission model.

Produce a markdown brief, MAX 200 lines, structured with these exact H2 sections:
## Viable approaches
## Battery + privacy tradeoffs
## What to vendor vs build
## Risks
## Sources

Output ONLY the markdown brief as your final message, no preamble. Keep it tight and decision-useful for engineers building a cross-platform screen capturer.
PROMPT

echo "start_epoch=$(date +%s)" > "$META"
echo "start_iso=$(date -u +%FT%TZ)" >> "$META"
echo "t3code_before=$(systemctl is-active t3code)" >> "$META"
echo "avail_before_mb=$(free -m | awk '/Mem/{print $7}')" >> "$META"

nohup omnigent run --harness acp:jcode -p "$(cat "$PROMPT_FILE")" --server local > "$RAW" 2>&1 &
OMNI_PID=$!
echo "omni_pid=$OMNI_PID" >> "$META"

PEAK_USED=0
MIN_AVAIL=999999
: > "$RAMLOG"
while kill -0 "$OMNI_PID" 2>/dev/null; do
  read USED AVAIL < <(free -m | awk '/Mem/{print $3, $7}')
  echo "$(date -u +%FT%TZ) used=${USED} avail=${AVAIL} t3=$(systemctl is-active t3code)" >> "$RAMLOG"
  [ "$USED" -gt "$PEAK_USED" ] && PEAK_USED=$USED
  [ "$AVAIL" -lt "$MIN_AVAIL" ] && MIN_AVAIL=$AVAIL
  if [ "$AVAIL" -lt 400 ]; then
    echo "KILL_FLOOR_HIT avail=${AVAIL} killing pid=$OMNI_PID" >> "$META"
    kill "$OMNI_PID" 2>/dev/null
    sleep 2; kill -9 "$OMNI_PID" 2>/dev/null
    echo "killed_for_ram=1" >> "$META"
    break
  fi
  sleep 5
done
wait "$OMNI_PID" 2>/dev/null
RC=$?
echo "end_epoch=$(date +%s)" >> "$META"
echo "end_iso=$(date -u +%FT%TZ)" >> "$META"
echo "exit_code=$RC" >> "$META"
echo "peak_used_mb=$PEAK_USED" >> "$META"
echo "min_avail_mb=$MIN_AVAIL" >> "$META"
echo "t3code_after=$(systemctl is-active t3code)" >> "$META"
echo "avail_after_mb=$(free -m | awk '/Mem/{print $7}')" >> "$META"
echo "DRIVER_DONE"
