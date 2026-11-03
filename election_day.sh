#!/usr/bin/env bash
# Election-day scheduler.
#
#   Phase 1 (turnout)   : top of every hour, 7:00 AM -> 6:00 PM
#                         plus a final pull at 6:59 PM, one minute before close
#                         runs ./refresh.sh  (county turnout feeds)
#   Phase 2 (results)   : every 10 minutes, 7:00 PM -> 3:00 AM
#                         runs results.py    (Florida Election Watch)
#   Phase 3 (projections): at :20 and :50, 7:00 PM -> 3:00 AM, in the
#                         background so it never delays a results pull
#                         runs projections.py (DDHQ forecasts + calls, markets)
#
# Usage:
#   ./election_day.sh            # foreground; Ctrl-C to stop
#   nohup ./election_day.sh &    # background
#   ./election_day.sh --dry-run  # print the schedule and exit
#   ./election_day.sh --status   # show what has run so far
#   ./election_day.sh --test     # print which phase fires at sample times
#
# Override the windows if needed:
#   TURNOUT_START=7 POLLS_CLOSE=19 RESULTS_END=3 RESULTS_EVERY=10 ./election_day.sh
set -uo pipefail
cd "$(dirname "$0")"

PY=".venv/bin/python"
TURNOUT_START="${TURNOUT_START:-7}"     # hour, 24h local
POLLS_CLOSE="${POLLS_CLOSE:-19}"        # hour polls close
RESULTS_END="${RESULTS_END:-3}"         # hour to stop (next morning)
RESULTS_EVERY="${RESULTS_EVERY:-10}"    # minutes
TURNOUT_EVERY="${TURNOUT_EVERY:-60}"    # minutes
ELECTION_DATE="${ELECTION_DATE:-2026-11-03}"   # nothing runs before this date
NEXT_DAY=$(date -d "$ELECTION_DATE +1 day" +%F 2>/dev/null || date -v+1d -j -f %F "$ELECTION_DATE" +%F)
LOG_DIR="logs"
mkdir -p "$LOG_DIR" results projections 2>/dev/null || true
STAMP_FILE="$LOG_DIR/.election_day_tick"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

schedule_text() {
  cat <<EOF
  turnout  : every ${TURNOUT_EVERY} min, $(printf '%02d' "$TURNOUT_START"):00 -> $(printf '%02d' $((POLLS_CLOSE-1))):00
  final pull: $(printf '%02d' $((POLLS_CLOSE-1))):59  (one minute before close)
  results  : every ${RESULTS_EVERY} min, $(printf '%02d' "$POLLS_CLOSE"):00 -> $(printf '%02d' "$RESULTS_END"):00 (next day)
  precincts: full CSV each results pull; page-scraped counties at :15 and :45
  projections: at :20 and :50, backgrounded so results is never blocked
  idle until: $ELECTION_DATE 07:00 if started earlier
  logs     : $LOG_DIR/
EOF
}

# Which phase, if any, fires at hh:mm? Echoes: turnout, turnout-final, results,
# results-final, or nothing.
phase_for() {
  local d=$1 h=$2 m=$3 p=""
  if [ "$d" = "$NEXT_DAY" ]; then
    # after midnight: only the tail of the results window belongs to us
    if [ "$h" -eq "$RESULTS_END" ] && [ "$m" -eq 0 ]; then
      p="results-final"
    elif [ "$h" -lt "$RESULTS_END" ]; then
      if [ "$m" -eq 15 ] || [ "$m" -eq 45 ]; then
        p="precinct-slow"
      elif [ $((m % RESULTS_EVERY)) -eq 0 ]; then
        p="results"
      fi
    fi
  elif [ "$d" = "$ELECTION_DATE" ]; then
    if [ "$h" -ge "$POLLS_CLOSE" ]; then
      if [ "$m" -eq 15 ] || [ "$m" -eq 45 ]; then
        p="precinct-slow"
      elif [ $((m % RESULTS_EVERY)) -eq 0 ]; then p="results"; fi
    elif [ "$h" -eq $((POLLS_CLOSE - 1)) ] && [ "$m" -eq 59 ]; then
      p="turnout-final"                      # last data before the feed is cut
    elif [ "$h" -ge "$TURNOUT_START" ] && [ $((m % TURNOUT_EVERY)) -eq 0 ]; then
      p="turnout"
    fi
  fi
  printf '%s' "$p"
}

run_phase() {
  local phase="$1"
  case "$phase" in
    turnout|turnout-final)
      log "turnout run ($(date +%H:%M)) [$phase]"
      ./refresh.sh >> "$LOG_DIR/turnout_$(date +%Y%m%d).log" 2>&1 \
        && log "turnout ok" || log "turnout FAILED (see $LOG_DIR)"
      ;;
    precinct-slow)
      log "precinct pull, slow counties ($(date +%H:%M))"
      "$PY" results_precinct_slow.py >> "$LOG_DIR/precinct_slow_$(date +%Y%m%d).log" 2>&1 \
        && log "precinct-slow ok" || log "precinct-slow FAILED"
      ;;
    results|results-final)
      # one gate at the top of the night: refuse to run on a wrong election
      if [ "$(date +%H)" = "$(printf '%02d' "$POLLS_CLOSE")" ] && [ "$(date +%M)" = "00" ]; then
        if "$PY" audit.py >> "$LOG_DIR/audit_$(date +%Y%m%d).log" 2>&1; then
          log "audit passed"
        else
          log "AUDIT FAILED - see $LOG_DIR/audit_$(date +%Y%m%d).log"
        fi
      fi
      # county results pages are stood up at close; refresh the map hourly
      if [ "$(date +%M)" = "00" ]; then
        "$PY" discover_links.py >> "$LOG_DIR/results_$(date +%Y%m%d).log" 2>&1 \
          && log "discovery refreshed" || log "discovery failed"
      fi
      # forecasts + calls ride alongside the results pull. Backgrounded and
      # lock-guarded so a slow or failed projections run can never hold up
      # results.py or anything queued behind it.
      case "$(date +%M)" in
        20|50)
          log "projections pull (:$(date +%M), background)"
          "$PY" projections.py >> "$LOG_DIR/projections_$(date +%Y%m%d).log" 2>&1 &
          ;;
      esac
      log "results pull ($(date +%H:%M)) [$phase]"
      "$PY" results.py >> "$LOG_DIR/results_$(date +%Y%m%d).log" 2>&1 \
        && log "results ok" || log "results FAILED (see $LOG_DIR)"
      ;;
    *) log "no phase scheduled for $(date '+%F %H:%M') - nothing to do" ;;
  esac
}

case "${1:-}" in
  --dry-run) echo "schedule:"; schedule_text; exit 0 ;;
  --test)
    echo "phase check ($ELECTION_DATE):"
    for t in 06:59 07:00 12:00 18:00 18:59 19:00 19:10 23:50; do
      printf '  %s %s -> %s\n' "$ELECTION_DATE" "$t" "$(phase_for "$ELECTION_DATE" "$((10#${t%%:*}))" "$((10#${t##*:}))")"
    done
    printf '  %s 00:00 -> %s\n' "$NEXT_DAY" "$(phase_for "$NEXT_DAY" 0 0)"
    printf '  %s 02:50 -> %s\n' "$NEXT_DAY" "$(phase_for "$NEXT_DAY" 2 50)"
    printf '  %s 03:00 -> %s\n' "$NEXT_DAY" "$(phase_for "$NEXT_DAY" 3 0)"
    printf '  %s 03:10 -> %s\n' "$NEXT_DAY" "$(phase_for "$NEXT_DAY" 3 10)"
    printf '  %s 20:30 (tonight, before election) -> [%s]\n' "$(date -d "$ELECTION_DATE -1 day" +%F)" "$(phase_for "$(date -d "$ELECTION_DATE -1 day" +%F)" 20 30)"
    exit 0 ;;
  --once)
    d=$(date +%F); h=$((10#$(date +%H))); m=$((10#$(date +%M)))
    ph="$(phase_for "$d" "$h" "$m")"
    if [ -z "$ph" ]; then
      exit 0    # nothing scheduled right now; stay silent for cron
    fi
    run_phase "$ph"
    exit 0 ;;
  --status)
    echo "schedule:"; schedule_text; echo
    echo "archived turnout runs : $(ls -1 runs 2>/dev/null | grep -c '^2026' || true)"
    echo "archived result pulls : $(ls -1 results 2>/dev/null | grep -c '^2026' || true)"
    echo "projection snapshots  : $(ls -1 projections 2>/dev/null | grep -c '^2026' || true)"
    echo "last tick             : $(cat "$STAMP_FILE" 2>/dev/null || echo none)"
    echo
    echo "results/INDEX.csv:"; tail -5 results/INDEX.csv 2>/dev/null | column -s, -t || true
    echo
    echo "projections/INDEX.csv:"; tail -5 projections/INDEX.csv 2>/dev/null | column -s, -t || true
    exit 0 ;;
esac


log "election-day scheduler started (pid $$)"
schedule_text

cleanup() { log "stopped"; exit 0; }
trap cleanup INT TERM

while :; do
  now_h=$((10#$(date +%H)))
  now_m=$((10#$(date +%M)))
  tick="$(date +%Y%m%d-%H%M)"
  last="$(cat "$STAMP_FILE" 2>/dev/null || true)"
  today="$(date +%F)"
  phase="$(phase_for "$today" "$now_h" "$now_m")"

  if [ -n "$phase" ] && [ "$tick" != "$last" ]; then
    echo "$tick" > "$STAMP_FILE"
    run_phase "$phase"
    if [ "$phase" = "results-final" ]; then
      log "final pull done - stopping"
      exit 0
    fi
  fi

  # stop only once the whole programme is behind us
  if [ "$today" \> "$NEXT_DAY" ] || { [ "$today" = "$NEXT_DAY" ] && [ "$now_h" -ge "$RESULTS_END" ]; }; then
    log "schedule complete - exiting"
    exit 0
  fi
  if [ "$today" \< "$ELECTION_DATE" ]; then
    [ "$now_m" = "00" ] && log "idle - waiting for $ELECTION_DATE"
  fi

  sleep 20
done
