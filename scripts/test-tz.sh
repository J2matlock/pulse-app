#!/usr/bin/env bash
# Runs the whole test suite once per time zone. Calendar-date bugs (UTC "today"
# in US evenings, DST-length days, half-hour offsets) only show up away from the
# machine's own zone. Extra args pass through to each run, like `npm test`.
set -u
ZONES=(UTC America/Los_Angeles Pacific/Auckland Asia/Kolkata)
FAILED=()
for zone in "${ZONES[@]}"; do
  echo "=== TZ=$zone ==="
  TZ="$zone" bash "$(dirname "$0")/run-tests.sh" "$@" || FAILED+=("$zone")
done
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Tests failed in: ${FAILED[*]}" >&2
  exit 1
fi
echo "Tests passed in all zones: ${ZONES[*]}"
