#!/usr/bin/env bash
# Website screenshots for starters (W16): sets each one up with its sample
# data in a fresh, throwaway app and copies the shots to
# plans/website/screenshots/<id>/. Opens an app window per starter.
#
#   scripts/website-copy/screenshots.sh                 # every starter
#   scripts/website-copy/screenshots.sh therapy-practice auto-service
set -euo pipefail
cd "$(dirname "$0")/../.."

ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
  for f in src/shared/starters/*.json; do ids+=("$(basename "$f" .json)"); done
fi

npm run build
for id in "${ids[@]}"; do
  echo "== $id"
  rm -rf "test-results/ui-tour/starters/$id"
  UI_TOUR=1 UI_TOUR_STARTER="$id" npx playwright test e2e/ui-tour.spec.ts -g "starter tour" --reporter=line
  mkdir -p "plans/website/screenshots/$id"
  cp "test-results/ui-tour/starters/$id/"*.png "plans/website/screenshots/$id/"
done
