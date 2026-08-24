# RTC integration test

Characterises how [VIP Real-Time Collaboration](https://github.com/Automattic/vip-real-time-collaboration)
interacts with a content-mutating **stage agent** (copy-edit), which rewrites
the post server-side with `wp_update_post()` while it runs. The question: does
RTC surface that "out-of-band" DB change in an open editor, or is a reload
still required?

**Answer this spec pins (VIP RTC v0.3.2 + the repo's dev WebSocket server):**

1. Live client-to-client sync works — typing in one browser appears in another.
2. A server-side `wp_update_post` (what the agent does) is **invisible** to open
   collab clients — it does not appear live.
3. It only surfaces once the room empties and the editor is reopened (bootstrap
   reads the DB). **A reload is required.** While the room is live, a client that
   saves can even overwrite the agent's change.

If a future RTC version *does* propagate the out-of-band write, assertion 2 flips
and the test fails — the signal to revisit the reload UX.

This spec is **not** part of the default e2e suite. It needs the RTC plugin +
Gutenberg + the RTC WebSocket server, and only runs when `RTC_E2E=1`; otherwise
it is skipped (safe in CI).

## Running it

From the monorepo root, with the dev wp-env up (`npm run wp-env:start`, :8888):

```bash
# 1. Provision the dev env for RTC (idempotent).
bash vip-workflow/tests/e2e/rtc/setup-rtc.sh

# 2. Get the WebSocket server, as a sibling of the monorepo (once):
#    git clone https://github.com/Automattic/vip-real-time-collaboration.git ../vip-real-time-collaboration
#    ( cd ../vip-real-time-collaboration/websocket-server && npm install )
#    Playwright starts it for you (see playwright.rtc.config.js). To run it
#    yourself instead, start it and pass RTC_WS_EXTERNAL=1:
#    VIP_RTC_WS_AUTH_SECRET=vip_rtc_ws_auth_secret PORT=1234 npx tsx index.ts

# 3. Run the spec (from vip-workflow/).
RTC_E2E=1 npx playwright test --config tests/e2e/rtc/playwright.rtc.config.js
```

Override the WebSocket server location with `RTC_WS_DIR=/path/to/websocket-server`.

## Notes

- The spec drives the **dev** env (:8888), not the standalone tests env (:8889),
  because RTC is provisioned there and its behaviour needs a real editor +
  WebSocket server. It uses two raw browser contexts and logs in as `admin`.
- **Gotcha:** if `wp plugin install gutenberg…` fails with "destination directory
  already exists and could not be removed," an empty `wp-content/plugins/gutenberg`
  mount was left by a failed wp-env download. Populate that mount directly (unzip
  the Gutenberg plugin into `~/.wp-env/<env-hash>/gutenberg/`) rather than
  reinstalling.
- CI wiring (provisioning the plugins + WS server on the runner) is deliberately
  left out for now — this is a local/opt-in integration harness.
