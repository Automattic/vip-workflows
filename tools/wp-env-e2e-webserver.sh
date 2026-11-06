#!/usr/bin/env bash
# Playwright `webServer` command for local end-to-end runs (see
# vip-workflows/playwright.config.js). CI starts and seeds the tests
# environment itself and does not use this script.
#
# Starts the wp-env tests environment (:8889, `.wp-env.tests.json`) and seeds
# it: `npm run wp-env:start:tests` runs `tools/wp-env-seed-tests.sh` as its
# post script. Only when both have succeeded does it print the ready line that
# Playwright waits for, so no spec or global setup can run against a
# half-seeded environment. Starting an environment that is already running is
# a no-op apart from the seed, which is additive and idempotent.
#
# It then stays alive, because Playwright treats a webServer command that
# exits as a failed start. Playwright stops it when the run ends; the wp-env
# containers keep running.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$ROOT"

npm run wp-env:start:tests

echo "VIP Workflows e2e environment ready"

while true; do
	sleep 3600
done
