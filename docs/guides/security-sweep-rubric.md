# Security Sweep Rubric

Use this rubric when reviewing `vip-workflow/` for security regressions. It is based on the June 2026 VIP security review and the July 8, 2026 follow-up catalog.

## Authorization And IDOR

- Per-object resources must use object-scoped capabilities, not bare global caps.
- Post-derived content, ability results, AI transcripts, ideation data, stories, and meta writes should require `current_user_can( 'edit_post', $id )` or a documented owner-or-meta-cap equivalent.
- List endpoints must not reveal objects the caller cannot access. Filter at query time where possible, then post-filter before serialization if capability mapping can be custom.
- Permission checks must validate the exact effective object that execution will use.

Checks:

- Search for `permission_callback` methods returning only `edit_posts`, `read`, or `manage_options` and classify whether the route is global or object-scoped.
- Search for request parameters like `post_id`, `project_id`, `story_id`, `note_id`, `ability_id`, `conversation_id`, `user_id`, and make sure each is re-gated against the object it selects.
- Check both read and write routes. Read endpoints often leak content-derived data even when writes are correctly gated.

## Capability Boundaries

- Standard WordPress capabilities remain security boundaries: `upload_files` for media, `edit_others_posts` or post-type meta caps for cross-author actions, and assign-author checks for author changes.
- Custom post types with `map_meta_cap => true` should use the meta cap, not hand-rolled role checks.
- Caller-supplied identity parameters such as `user_id` are suspicious. Prefer `get_current_user_id()`.

Checks:

- Compare plugin routes to the equivalent core REST controller behavior.
- Verify author reassignment, uploads, transitions, and meta writes enforce the same capability a core path would enforce.

## AI Agent And Ability Safety

- Autonomous agent loops may only execute abilities explicitly marked read-only.
- Write abilities need a human-originated server-side confirmation path if they are exposed through an agent UI.
- Prompt-injected post content must be treated as data, not instructions. Delimiters help but do not replace authorization and write gates.
- Tool-call arguments cannot override the conversation or request scope.

Checks:

- Inspect ability metadata: `annotations.readonly`, `destructive`, `requires_confirmation`, MCP exposure, and command visibility.
- Confirm the agent executor enforces read-only metadata at execution time, not just in the prompt.
- Test `options.post_id` and similar nested overrides.

## XSS And DOM Sinks

- Anything rendered through `dangerouslySetInnerHTML` or `innerHTML` must be escaped or sanitized for the destination context before injection.
- Data read from `dataset` is decoded text. Do not move it into HTML via string concatenation.
- Extension-provided strings such as icons, labels, channel names, status names, and model output should render as text unless an explicit sanitized markup contract exists.

Checks:

- Search for `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, template strings containing markup, and inline `style` strings.
- Trace whether the source is model output, user input, config, imported JSON, or third-party extension data.
- Prefer React text nodes and DOM APIs with `textContent`.

## File, URL, And Media Handling

- Attachment paths from `get_attached_file()` are not trusted by themselves. Resolve with `realpath()` and require the path to be inside `wp_get_upload_dir()['basedir']` before reading or sending to AI providers.
- URL downloads must go through SSRF protection with redirects disabled unless there is a reviewed exception.
- Invalid attachment paths fail closed. Do not silently fall back to a different source when an explicit attachment was selected.

Checks:

- Search for `get_attached_file`, `file_get_contents`, AI Client file DTOs, PDF parsers, and media upload handlers.
- Confirm every file read has an uploads-boundary guard or a documented non-attachment source.
- Confirm every remote fetch uses `SsrfGuard` or WordPress HTTP APIs with equivalent host/IP protections.

## Credentials And Secrets

- Prefer env vars or constants for production secrets.
- If secrets can be stored in the database, document whether they are encrypted/protected at rest and who controls that guarantee.
- Central credential facades are good, but they do not by themselves prove at-rest security.

Checks:

- Search for `get_option`, `update_option`, connector settings, `wp_salt`, `openssl_*`, API-key constants, and environment variable reads.
- Verify precedence: env/constant should beat DB storage.
- Confirm docs match the active credential backend.

## Dependency Exposure

- Distinguish runtime/shipped dependencies from dev/build-only dependencies.
- A high or critical advisory in a shipped runtime package blocks release unless patched or explicitly risk-accepted.
- Dev-only advisories still need owner, expiration, and rationale.

Checks:

- Run `composer audit`.
- Run `npm audit --omit=dev` for shipped package surfaces.
- Run full npm audit for build tooling and record why any accepted advisory cannot affect runtime.

## Extensibility And Stored Callbacks

- Stored config must not contain arbitrary PHP callables that are executed later.
- Extension callback systems should use named allowlists registered in code.
- Imported config should pass through the same sanitization and validation as create/update forms.

Checks:

- Search for `call_user_func`, `is_callable`, filters that accept callbacks, imported JSON paths, and config replay paths.
- Confirm stored callback IDs resolve through a registry or filter allowlist.

## Abuse, Cost, And Rate Limits

- AI mentor/evaluation routes are write/cost routes even if they return analysis. They need edit permissions and abuse controls.
- Notifications and background actions need meaningful debouncing/rate limits.
- Expensive endpoints should not be globally enumerable.

Checks:

- Identify routes that trigger AI calls, notifications, background jobs, imports, media processing, or external API calls.
- Verify capability gates, per-object gates, nonce/REST auth, and rate limits.

## Required Regression Tests

Every security fix should include at least one negative test that proves the old exploit fails.

Minimum examples:

- Contributor cannot read another author's post-derived ability result, AI transcript, ideation project, or story.
- Nested options cannot override a checked `post_id`.
- Model output containing `<script>` or `<img onerror>` renders inert.
- `get_attached_file()` resolving outside uploads does not reach file readers or AI clients.
- A role with `edit_posts` but no `upload_files` cannot upload through plugin endpoints.
- A write-capable ability cannot run through the autonomous AI loop.
