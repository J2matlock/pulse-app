#!/usr/bin/env bash
# The commit gate (npm run gate): typecheck, eslint errors, full test suite. Must be green before a commit.
set -euo pipefail
npm run typecheck
npx eslint src --quiet
npm test
