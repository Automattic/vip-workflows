# Supported AI Providers and Models

**Scope:** the provider and model an administrator selects under VIP Workflow → Settings for general AI generation — media analysis, ideation, research, stage agents, and the AI extension tools. Not the search/media services (Tavily, YouTube), which are not AI Client providers.

**Audience:** whoever is answering "is this model supported?" or "why did this generation fail on our model?".

## The short version

| Provider / model | Claim |
|---|---|
| `anthropic` / `claude-sonnet-5` | **Verified.** Measured end to end; evidence below. |
| `openai` / `gpt-4o` | **Verified.** Measured end to end; evidence below. |
| Anything else the settings dropdown offers | **Expected to work, untested.** Nothing is known to be broken, and nothing has been measured. |

The dropdown is populated live from whatever the provider's own `models` endpoint returns, so it lists far more than the two rows above. That is deliberate — a model absent from this page is not blocked. It just has no evidence behind it, and the failure modes below are the ones to check first when something goes wrong.

## Why these two are called verified

"Verified" here means the plugin's real generation paths were run against the live model and the results measured — not that the model appears in a vendor table.

### `anthropic/claude-sonnet-5`

- **Reasoning is billed against `max_tokens`, and it is not disclosed to the model.** Measured at roughly **3,900–4,000 tokens** across two sampled stage agents, with whole runs totalling 4.4–5.2k. Reasoning did not scale with the size of the reply. This measurement is what `LlmTextGenerator::THINKING_FLOOR` (6,000) is sized from: it clears the measured reasoning by about 1.5× and still leaves roughly 2,000 tokens for an answer. A ceiling below the floor can be spent entirely on reasoning, returning a candidate with a thought part, no content part, and a `length` finish reason.
- **`temperature` is rejected.** The model answers any request carrying the option with an HTTP 400, so no sampling option is sent anywhere in the plugin. The AI Client's metadata cannot be used to send it selectively — see *Metadata cannot be trusted* below.
- **Maximum output: 128,000 tokens.** Far above every ceiling in the repo, so bounding never binds on this model.

### `openai/gpt-4o`

- **No reasoning cost.** The floor is simply headroom here rather than a requirement.
- **`temperature` is accepted** — but is still not sent, because the setting is global and the plugin cannot vary the request per model without trustworthy metadata.
- **Maximum output: 16,384 tokens.** This one matters. The PDF extraction path in `class-media-processor.php` asks for `THINKING_FLOOR + 10000` = **16,000 tokens**, which clears the limit by **384 tokens**. It fits, and it is the narrowest margin in the repo.

## The two provider facts that bite

**1. Core ships no concrete providers.** The bundled `wordpress/php-ai-client` package contains only abstract provider base classes, the registry, and DTOs. There is no Anthropic, OpenAI, or Google implementation inside it. Selecting Anthropic or Google therefore requires the corresponding provider plugin (`ai-provider-for-anthropic`, `ai-provider-for-google`) to be installed and active. Without it the provider is not in the registry, `AiInference::model()` resolves nothing, and generation fails — reported by `AiInference` and by the availability gate, not silently.

**2. Thinking is adaptive, so risk is not uniform.** The model decides how much to reason per request. The 3,900–4,000 token measurement above is a sample against particular prompts, not a constant. A longer rule applied over a longer document will reason more, so the headroom above the floor is thinner for complex prompts than the numbers suggest. Treat the floor as a measured minimum, not a guarantee — and expect the same ceiling to behave differently as prompts grow.

## Failure modes, and how each one presents

| Symptom | Cause | Where it is reported |
|---|---|---|
| "used its entire N-token limit before it finished" | The ceiling was spent on reasoning plus a partial reply. | `LlmTextGenerator::generate()` reads the `length` finish reason and says so, naming the ceiling. |
| HTTP 400 from the vendor, whole request refused | A ceiling above the model's maximum output, or an unsupported option. | The provider's own exception text. There is no candidate, so none of the reporting above runs — which is why ceilings are bounded before the request is built. |
| "returned no response at all" | No candidates came back. | `LlmTextGenerator::generate()`. |
| Generation fails immediately on a freshly selected provider | Provider plugin not installed (fact 1). | `AiInference::model()` via `_doing_it_wrong`, plus the availability gate. |
| A PHP notice about a clamped ceiling | The selected model's maximum output is below a configured ceiling. | `LlmTextGenerator::bounded_max_tokens()`. |

## Output limits are hand-maintained, not discovered

Ceilings are bounded to the resolved model's maximum output by `LlmTextGenerator::bounded_max_tokens()`, using the `MODEL_OUTPUT_CAPS` table in the same class. That table is maintained by hand because the AI Client cannot supply the numbers:

- `ModelMetadata` carries exactly four fields — `id`, `name`, `supportedCapabilities`, `supportedOptions` — and its JSON schema declares only those, so no provider plugin can add a limit either. There is no output-limit field anywhere in the package.
- `maxTokens` appears in the package only as a **request input** (`ModelConfig::setMaxTokens()`, `PromptBuilder::usingMaxTokens()`) — what a caller asks for, never what the model allows.
- A `maxTokens` entry in `supportedOptions` means "this model accepts the parameter". It carries no numeric bound, and could not express one: `SupportedOption` holds an enumerated allow-list, not a range.

The table lists published vendor figures, and only where they matter — models capping below the largest ceiling in the repo (which a bound can rescue), plus the two verified models. A model absent from the table is passed through unbounded, which is the safe direction: a missing entry preserves existing behaviour, while a wrong-low entry would cut a budget for no reason. `LlmTextGeneratorCeilingTest` pins the two verified caps and asserts that every ceiling in the repo is bounded.

## Metadata cannot be trusted to fill these gaps

`ModelMetadata::getSupportedOptions()` misreports. `claude-sonnet-5` advertises `temperature` as supported even though the API rejects it, because the Anthropic provider builds **one hardcoded option list and shares it across every model it enumerates** — its own comment concedes the API reports no capabilities. The only per-model variation in that method is a regex adding `webSearch` for post-Claude-3 models. The Google provider follows the same pattern.

This is why two plausible-looking designs are not used: sending `temperature` only where metadata says it is supported (it lies), and deriving token budgets from metadata (the field does not exist). Both would build on a value that is either wrong or absent.

## Deliberately out of scope

- **A per-provider live-call smoke matrix in CI.** Three credential sets, real spend on every run, and network flake becoming a red build. Verification stays manual and is recorded here instead.
- **Deriving budgets from model metadata generally**, or using `output_config: {effort: 'low'}` to control reasoning. Both depend on metadata being trustworthy.
- **Revisiting the `temperature` removal.** Settled; see above.

## Extending this page

Adding a row to the verified table means running the plugin's real paths against the live model and recording *what was measured* — reasoning cost, which options are refused, and the maximum output — in the same shape as the two entries above. A vendor documentation link is not verification. If a model's published cap is added to `MODEL_OUTPUT_CAPS` without an end-to-end run, it belongs in the table but not in the verified list.
