# Workflow: Parse.ly

Bridge plugin that wires [wp-parsely](https://github.com/Parsely/wp-parsely)'s capabilities into
VIP Workflow's extension points. wp-parsely is consumed as an unmodified dependency.

Shipped: smart linking as a tool and as a workflow stage, headline scoring, trending topics as a
discovery provider, and a past-performance signal available in ideation, from the command palette,
and as a transition check.

Still planned: Traffic Boost as a post-publish stage.

## Requirements

- `vip-workflow` active
- `wp-parsely` active and configured with a Parse.ly Site ID and API Secret

wp-parsely is installed into the local dev environment via `.wp-env.json`.

**wp-parsely is not named in this plugin's `Requires Plugins` header.** WordPress's dependency
resolver only sees plugins in `wp-content/plugins`, and on VIP wp-parsely is commonly loaded as an
mu-plugin — naming it there makes this plugin permanently unactivatable on exactly the sites it is
built for, reporting that wp-parsely is not installed while it is loaded and working. The runtime
class check is stronger and covers every load path; a missing dependency is reported on the
Integrations card instead of as a failed activation.

## Two exceptions to "a bridge and nothing else"

This plugin is otherwise only glue: it consumes wp-parsely unmodified and adds no Parse.ly logic of
its own, and it uses VIP Workflow's published extension points rather than changing them. Two things
sit outside that, both deliberate and both recorded here so they are not mistaken for drift.

**1. A `/search` endpoint class lives in this plugin.** `/search` is the only Content API endpoint of
consequence wp-parsely does not wrap, and it is the only one that takes *text* — which the
performance signal needs, because it scores candidates that have no URL on the site yet. `/related`
resolves a URL Parse.ly already indexes; `/analytics/posts` ranks but cannot answer a query.

`includes/parsely/class-endpoint-search.php` is written in wp-parsely's own idiom so upstreaming it
is a file move plus a registration line, and `ParselyClient::search()` feature-detects
`get_search_results()` so the local copy becomes deletable the moment wp-parsely ships its own.

**2. One core VIP Workflow change.** Enriching another provider's prompts has no seam — a provider
only sees its own results — so `vip_workflow_discovery_prompts` was added to the discovery
controller. It is documented in `docs/reference/extension-points.md` section 11, including the
priority contract this plugin and `workflow-discovery-stream` depend on.

## The performance signal

`PerformanceLens` scores a candidate against how comparable past coverage performed, and knows
nothing about ideation — it takes a title and returns a score plus its evidence, so a diary event, a
wire item and a draft headline all score the same way.

Three things about it are worth knowing before changing it, each learned from live data rather than
reasoned from first principles:

- **Performance is measured over an article's own first N days**, not over a recent traffic window.
  Otherwise an older article is compared on residual trickle against a recent one mid-spike.
- **The lookback stops at Parse.ly's retention.** Old windows return *near-zero rather than an
  error*, which is indistinguishable from a genuine flop and drags the median down silently.
- **Matches must clear a term-overlap floor.** `/search` always returns its best effort, so without
  one every candidate appears to have precedent.

**The denominator is a census, not a top-N average.** "There is no per-story average, and the
obvious substitute is wrong" below records why comparing a topic's top-N average against the site's
top-N average makes every subject look like it underperforms. Search solves finding comparable
articles; it does not supply a denominator. This one comes from *whole publication days*: pinning
`pub_date_start` and `pub_date_end` to the same day makes the top-2000 ranking simply every article
published that day, tail included. Measured live, that is 208-431 rows with minimums of 1 and 3
views, median 3-7k — against 60-177k for the top-N head, a factor of twenty of pure bias. A day that
comes back at the row cap has been truncated back into a head and is discarded rather than pooled.

The sample days are anchored to a weekly grid rather than counted back from today. A closed day's
figures can never change, so each cohort is cached for a month — but while the dates were counted
from today they all moved at midnight, every key was cold every morning, and the census was
re-fetched daily for numbers it already held under yesterday's key.

**The arithmetic is replaceable.** `workflow_parsely_performance_signal` receives the finished
signal *and everything it was derived from* — every measured article with its value, and the full
census distribution. That is enough to compute a different answer (a trimmed mean, a recency
weighting, a comparison against something else entirely), to enrich it with further calls, or to
discard it and return your own. `PerformanceLens::calculate()` is public so a listener can start
from the default arithmetic rather than reimplement it, and the return is normalized, so a listener
may return only the keys it wants to change.

Collection is the expensive, Parse.ly-specific half. What "performed well" means is one opinion, and
a newsroom may hold a different one.

**On selection bias.** The obvious worry is that the numerator comes from ranked search results
while the denominator is a census — a head divided by a body. It was measured rather than assumed:
boosted and unboosted search returned identical medians on every topic tested, and sampling across
the result set instead of its head moved the answer in both directions rather than consistently
downward. So the effect is small here. The sample is nonetheless spread rather than taken from the
head, since that is the honest construction and costs the same.

**The signal reports a tier, not a figure.** Three bands, whose bounds are set on the "Compare to
past performance" tool and read by every surface — the ideation cards, the check itself, and the
stream's sections. Tier 1 is at or above `tier_1_min`, Tier 3 at or below `tier_3_max`, Tier 2 the
band between. Anything without enough comparable coverage to band falls into Tier 3 rather than a
section of its own — so the bottom band holds both weak topics and unknown ones, and the card's own
evidence is what separates them. Labels are renameable one at a time through
`workflow_parsely_tier_label`.

The tier is carried by the section heading and nowhere else. A per-card badge repeating it under its
own heading was noise, and a card with no badge is one fewer number to read as a target.

Bands rather than the multiple because bands are what the measurement supports, and because a band
cannot be aimed at. **Neither bound hard-blocks anything.** On a transition, every titled result is
shown as a soft warning so the editor sees the comparison and chooses Continue or Cancel; outside a
transition the same result is reported without an issue. The tier describes how comparable coverage
performed before, and says nothing about whether this story should run. Plenty of necessary
journalism lands in the weakest band, so a newsroom that wants a hard floor should build that as a
separate check.

**A transition never waits for the comparison.** Cold, it takes tens of seconds — a search, a
measurement call per comparable article, and a census call per reference day. That is time well
spent when an editor opened the tool and is watching it work, and wasted while a transition waits.
So attached to a transition the check reads its cache and nothing else: a hit shows the real tier in
the confirmation modal; a miss says the comparison is still being gathered, schedules it in the
background, and offers Continue or Cancel immediately. Running the tool by hand fills the same
cache, so a comparison made while writing is the one the transition reports. The cached comparison
is keyed on the headline and tags, so editing either asks the question again rather than answering
the old one.

**What the number underneath is for.** It ranks well and quotes badly, and the gap between those two is the
thing to hold on to. Resampling real topics, the ordering between them is right 97% of the time at
twelve comparable articles, while the value's own 10th-90th spread is still about as wide as the
value itself. "This topic tends to do better than that one" is supported. "This topic does 3.4x" is
not. And "get this story to 3.4x" is not something the number can mean at all — it describes what
already happened to other articles, so anything built on top of it as a target inherits an
uncertainty band wider than most of the differences it would be used to judge.

**The typical value is a geometric mean, not a median.** Traffic spans orders of magnitude, and the
difference between 1,000 and 10,000 views is the same kind of difference as between 10,000 and
100,000 — only a log-space average treats it that way. It also sorted better at every sample size
when measured: 83% against the median's 80% at three comparable articles, 88% against 84% at five,
97% against 94% at twelve, because it uses every value rather than discarding all but the middle one.

The census denominator stays a median. That side has thousands of values, so it has no variance
problem for a geometric mean to solve, and "half the newsroom's output did better than this" is the
more intuitive anchor. Making both sides geometric would scale every multiplier by about 1.35 and
change no ordering whatsoever, so it is a presentation choice rather than an accuracy one.

**There is a floor, and it is measured.** Below `min_matches_to_report` (five) the signal returns its
matches and their values but no multiplier, so nothing is shown rather than a figure that cannot
carry its own precision. Resampling real topics against their full-sample ranking, the share of topic
pairs that sort correctly is 80% at three comparable articles, 84% at five, 91% at eight and 94% at
twelve. Five is where ordering becomes more useful than not.

Precision is worse than ordering and stays worse — at five articles the multiplier's 10th-90th
percentile spread is still wider than the value itself, and it is still around 96% of it at twelve.
The number ranks reliably long before it quotes reliably. Treat the ordering of a board as the
finding and any single figure as approximate.

## wp-parsely interface inventory

Recorded against **wp-parsely 3.23.5**. Everything else in this plugin depends on it.

**Finding: both capability layers are public PHP service classes, directly callable by another
plugin.** They are not UI-coupled, and the bridge does not need to go through wp-parsely's REST
routes or reimplement anything.

### `Parsely\Services\Suggestions_API\Suggestions_API_Service`

| Method | Serves |
| --- | --- |
| `get_smart_links( string $content, $options )` | Smart Linking, as a tool and as a stage |
| `get_title_suggestions( string $content, $options )` | Headline scoring |
| `get_inbound_links( WP_Post $post, $options )` | Traffic Boost |
| `get_inbound_link_positions( WP_Post $source, WP_Post $destination, $options )` | Traffic Boost placement |
| `get_brief_suggestions( string $title, string $content, $options )` | Unused; possible ideation input |
| `get_check_auth( array $options )` | Credential validation |

### `Parsely\Services\Content_API\Content_API_Service`

| Method | Serves |
| --- | --- |
| `get_posts( array $params )` | Trending / top content |
| `get_post_details( … )` | Per-article performance |
| `get_related_posts_with_url( string $url, array $params )` | Similar-topic lookup |
| `get_related_posts_with_uuid( string $uuid, array $params )` | Similar-topic lookup |
| `get_post_referrers( … )` | Audience behaviour |
| `validate_credentials( string $api_key, string $secret_key )` | Credential validation |

#### What `get_posts()` actually returns

Captured from a live response, because three of these fields are not what the
endpoint's type declaration implies:

- **There is no description, excerpt, or summary.** A row carries `title`, `url`,
  `link`, `author`, `authors`, `section`, `tags`, `pub_date`, `image_url`,
  `thumb_url_medium`, `metrics`, `full_content_word_count` and `_hits`. Anything
  needing prose has to compose it from those.
- **`url` and `link` both carry an `itm_source=parsely-api` tracking parameter.**
  Strip it before showing or storing the URL, or it ends up published as a link
  to your own site with Parse.ly's attribution on it.
- **`metrics` holds only the keys implied by the requested `sort`.** Sorting by
  views returns `views` and `recirculation_rate`; `visitors` and `avg_engaged`
  are simply absent. Read every metric defensively.

Empty results come back as an empty `data` array, not an error. A missing `data`
key is the error case.

#### There is no per-story average, and the obvious substitute is wrong

`/analytics/posts` returns the **top** N by the requested metric. A site-wide
query is therefore the head of the whole distribution, while a tag-filtered query
of the same size reaches into one slice's long tail. Comparing their averages
compares a head against a body.

Measured against a real publication, every topic landed below the site baseline —
artificial intelligence at 0.32x, astronomy at 0.03x. That says nothing about the
topics; it is an artefact of the two queries. Any "topic performance score" built
this way tells every editor that every subject underperforms.

`/analytics/tags` returns a per-tag view **total** with no post count, so no
average is derivable there either, and it is outside the endpoint set wp-parsely
exposes.

What is honest is a count — how many of the site's best-performing stories carry
a tag, and whether that is more than the previous window. `period_end` accepts a
relative value (`period_start=14d&period_end=7d`), verified to return a genuinely
different set, which is what makes the previous-window comparison real.

#### Tags carry layout directives, not just topics

Publications use the tag field for presentation and syndication control, and
Parse.ly returns all of it. On one real site `splitscreenimagerightinset` sat on
60 of the 100 best stories and `web` on 87. Filter before treating tags as
subjects, or an editor is told their strongest topic is a template name.
`parsely_smart:` tags are Parse.ly's own entity extraction and duplicate the
editorial tag beside them.

The convention varies by publication, so a filter written against one site will
not hold. Two real examples:

| Site | Non-topic tags |
| --- | --- |
| A consumer title | `splitscreenimagerightinset`, `textaboveleftsmall`, `onecolumnnarrow`, `web` |
| A research publisher | `313764__post`, `category__politics-policy`, `format__quiz`, `team__politics` |

The first is layout directives. The second is a parallel taxonomy keyed with a
`__` separator — post ids, categories, formats and owning teams — where the only
genuine topics sit in the same list unprefixed. Treat an unrecognised convention
as non-topic rather than assuming a fixed list covers it.

### Credentials

wp-parsely owns them; the bridge reuses rather than duplicating. Read via `Parsely\Parsely`:
`get_options()`, `api_secret_is_set()`, `get_api_secret()`.

#### Analytics and Suggestions are entitled separately

One Site ID, two entitlements. A key with complete analytics access can have no
Suggestions access at all, and that is the common case rather than the exotic
one — of four real Site IDs tested, three had analytics and no Suggestions. The
refusal is `NO_AUTHORIZATION` on the call; nothing local distinguishes the two
states beforehand.

So a Site ID being present tells you nothing about what it can do. Smart Linking
and headline suggestions need the Suggestions entitlement; trending topics needs
only analytics. They report availability separately for that reason.

**`get_check_auth()` cannot be used to test this.** It returns a 403 body as a
*success* — the plain array `{"code":403,"message":"Forbidden"}` rather than a
`WP_Error` — so the one method whose purpose is answering "does this Site ID have
access?" answers yes when the answer is no. The trustworthy signal is the
`NO_AUTHORIZATION` code on a real call.

`Content_API_Service::validate_credentials()` performs a real network check. It is for a
deliberate, user-initiated validation — **not** for the availability callback, which is read on
every Agents-page load and several times per settings save, where a round trip per read would make
the admin crawl. Availability reads the stored option and reports what Parse.ly has already
refused; it never calls out.

Do not replace that with a bare "wp-parsely is active" check either — that fails open, which this
codebase has been bitten by before.

### Naming discrepancy

The feature is often called **Engagement Boost**; wp-parsely 3.23.5 calls it **Traffic Boost**
(`class-endpoint-traffic-boost.php`, `class-endpoint-traffic-boost-settings.php`). Same thing —
worth knowing before searching the source for the wrong name.

### Note on excerpt generation

wp-parsely ships `class-endpoint-excerpt-generator.php`. Any separate excerpt
generation extension should account for that overlap before Parse.ly support is
adopted here.

## Parse.ly data available (via the Parse.ly Analytics API)

Surveyed through the Parse.ly MCP, which is backed by the same Analytics API wp-parsely calls, so
the available metrics carry over regardless of transport.

- **Trending / top content** — rankable by `views`, `visitors`, `engaged_minutes`, `shares`,
  `recirculation_rate`; real-time (`minutes`) or historical windows; filterable by
  section / author / tag. Covers trending topics, including per-coverage-area segmentation.
- **Headline A/B tests** — variants with click, impression and CTR stats plus the decided winner.
  Directly serves "which headline got the most CTR".
- **Audience segments** — `sid` segment filter, `visitors_new` / `visitors_returning`,
  `engaged_minutes`, `recirculation_rate`. Serves audience resonance.
- **Per-post and related-post detail** — serves article-angle framing.

**The MCP is not a runtime dependency and must not become one.** It is OAuth-gated and scoped to
the authenticated user's own publishers — a customer sees only their sites. (The survey above was
run with staff privileges, which is why it enumerated several hundred publishers; that breadth is a
property of the account, not of the MCP.) Either way it is the wrong transport for a
customer-installed WordPress plugin, which must use that site's own Parse.ly credentials via
wp-parsely. The MCP was used here only to learn what metrics exist.

### Known MCP-layer caveats

Tracked by the Parsely team; relevant only if the MCP is ever used for investigation, not runtime.
Several advertised filters were silently ignored by the backend — comparison windows across ten
tools, `referrer_domain` in top-content queries — some since fixed. Verify a filter actually
changes results before trusting it.
