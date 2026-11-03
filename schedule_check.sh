#!/usr/bin/env bash
# Print every minute at which the scheduler would actually fire.
#
# Reads phase_for() straight out of election_day.sh and replays it for every
# single minute from 00:00 on election day to 04:00 the next morning, so it
# cannot drift from the real logic. It never modifies or runs election_day.sh,
# which means it is safe to use while the scheduler is live.
set -uo pipefail
cd "$(dirname "$0")"

ELECTION_DATE="${ELECTION_DATE:-2026-11-03}"
TURNOUT_START="${TURNOUT_START:-7}"
POLLS_CLOSE="${POLLS_CLOSE:-19}"
RESULTS_END="${RESULTS_END:-3}"
RESULTS_EVERY="${RESULTS_EVERY:-10}"
TURNOUT_EVERY="${TURNOUT_EVERY:-60}"
NEXT_DAY=$(date -d "$ELECTION_DATE +1 day" +%F)

FN=$(sed -n '/^phase_for() {/,/^}/p' election_day.sh)
if [ -z "$FN" ]; then
  echo "could not extract phase_for() from election_day.sh" >&2
  exit 1
fi
eval "$FN"

echo "Full replay of phase_for(), every minute, $ELECTION_DATE 00:00 -> $NEXT_DAY 04:00"
echo

turnout_n=0; results_n=0; prec_n=0; proj_n=0
for hh in $(seq 0 28); do
  if [ "$hh" -lt 24 ]; then d="$ELECTION_DATE"; h=$hh; else d="$NEXT_DAY"; h=$((hh-24)); fi
  for m in $(seq 0 59); do
    ph=$(phase_for "$d" "$h" "$m")
    [ -z "$ph" ] && continue
    case "$ph" in
      turnout|turnout-final) turnout_n=$((turnout_n+1)) ;;
      precinct-slow) prec_n=$((prec_n+1)) ;;
      *) results_n=$((results_n+1)) ;;
    esac
    # projections ride inside the results phase, at :20 and :50, backgrounded
    case "$ph" in
      results|results-final) case "$m" in 20|50) proj_n=$((proj_n+1)) ;; esac ;;
    esac
    printf '  %s %02d:%02d  %s%s\n' "$d" "$h" "$m" "$ph" \
      "$(case "$ph:$m" in results:20|results:50) echo ' (+projections)' ;; *) echo '' ;; esac)"
  done
done

echo
echo "  turnout runs : $turnout_n   (07:00-18:00 hourly + 18:59 final)"
echo "  result pulls : $results_n   (19:00-03:00 every ${RESULTS_EVERY} min)"
echo "  precinct slow: $prec_n   (19:15-02:45 at :15 and :45)"
echo "  projections  : $proj_n   (inside the results phase, at :20 and :50)"
echo "  total        : $((turnout_n + results_n + prec_n + proj_n))"
