#!/usr/bin/env bash
# Provision the running dev wp-env (:8888) for VIP Real-Time Collaboration so the
# RTC integration spec can run. Idempotent — safe to re-run.
#
# What it does:
#   - installs + activates the Gutenberg plugin (RTC requires >= 22.8.1)
#   - installs + activates vip-real-time-collaboration (from a GitHub release)
#   - turns on the `wp_collaboration_enabled` option
#   - defines the three VIP_RTC_WS_* constants the plugin needs
#
# It does NOT start the WebSocket server — that lives in the RTC repo and must be
# run separately (see tests/e2e/rtc/README.md). Run this from the monorepo root.
set -euo pipefail

GUTENBERG_ZIP="https://downloads.wordpress.org/plugin/gutenberg.23.3.2.zip"
RTC_ZIP="https://github.com/Automattic/vip-real-time-collaboration/releases/download/v0.3.2/vip-real-time-collaboration.zip"
WS_SECRET="${VIP_RTC_WS_AUTH_SECRET:-vip_rtc_ws_auth_secret}"
WS_URL="${VIP_RTC_WS_URL:-ws://localhost:1234}"

cli() { npx wp-env run cli wp "$@"; }

echo "→ Ensuring Gutenberg is installed + active"
if ! cli plugin is-active gutenberg >/dev/null 2>&1; then
	cli plugin install "$GUTENBERG_ZIP" --activate
fi

echo "→ Ensuring vip-real-time-collaboration is installed + active"
if ! cli plugin is-active vip-real-time-collaboration >/dev/null 2>&1; then
	cli plugin install "$RTC_ZIP" --activate
fi

echo "→ Enabling collaboration option"
cli option update wp_collaboration_enabled 1 >/dev/null

echo "→ Defining VIP_RTC_WS_* constants"
cli config set VIP_RTC_WS_AUTH_SECRET "$WS_SECRET" --type=constant >/dev/null
cli config set VIP_RTC_WS_URL "$WS_URL" --type=constant >/dev/null
cli config set VIP_RTC_WS_AUTH_TOKEN_EXPIRE_SECONDS 3600 --raw --type=constant >/dev/null

echo "✔ RTC provisioned. Start the WebSocket server next (see tests/e2e/rtc/README.md),"
echo "  then run: RTC_E2E=1 npx playwright test --config tests/e2e/rtc/playwright.rtc.config.js"
