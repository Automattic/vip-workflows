---
status: shipped
version: 1.1
last_updated: 2026-08-12
related:
  - active/story-entity.md
  - active/ideation-system.md
  - shipped/open-region-crossings.md
---

# Content Hierarchy

## Overview

```
Story
  "Mayoral Race Deep Dive"
  story status: monitoring
  │
  ├── Ideation Project (vip_research)
  │     seed, AI research, pinned cards
  │
  ├── Article (post) — "Inside the Mayoral Race"
  │     long-form analysis, WordPress status: publish
  │
  └── Article (post) — "Mayoral Candidates: Quick Guide"
        sidebar explainer, WordPress status: publish


Story
  "School Board Candidates"
  story status: production
  │
  ├── Article (post) — "School Board Race Heats Up"
  │     WordPress status: draft
  │
  └── Article (post) — "Meet the Candidates"
        WordPress status: draft


Story
  "Ballot Measures Explainer"
  story status: ideation
  │
  └── Ideation Project (vip_research)
        still researching, no article yet


Story
  "Breaking: City Hall Fire"
  story status: published
  │
  └── Article (post, created directly)
        WordPress status: publish


Story (refresh cycle)
  "Remote Work Trends 2025"
  story status: refresh
  │
  ├── Ideation Project (vip_research) — original research
  │
  ├── Article (post) — "Remote Work in 2025: What Changed"
  │     original article, WordPress status: publish
  │
  └── Article (post) — "Remote Work 2026 Update"
        refresh article, WordPress status: draft
```

A story can contain multiple articles. A refresh cycle may produce a new article within the same story rather than editing the original.

## Relationships

```
   ┌────────────┐
   │   Story    │
   │            │
   │ own status │
   │ own meta   │
   └─────┬──────┘
         │
         │  join: wp_vip_story_objects (per story)
         │  + _vip_story_id meta on each object
         │
    ┌────┴─────────────┐
    │                  │
    ▼                  ▼
 ┌─────┐          ┌──────┐
 │Idea-│          │Arti- │
 │tion │          │cle   │
 └─────┘          └──────┘
```

## Three Layers of Status

Each layer is independent. They do not influence each other directly.

```
Story Status          What stage is this content in its lifecycle?
                      ideation | editorial | published | monitoring | refresh | archived
                      Automatic transitions driven by object events.
                      Lives on the vip_story CPT.

Editorial Status      Where is this content in its review process?
                      Defined by editorial sequences (type: 'workflow', e.g., draft -> review -> ready -> publish -> promote)
                      Lives on the article as the `_vip_workflows_current_stage_key` post meta
                      (the sole authority). Queried via the StageQuery seam.
                      Managed by StatusManager. NOT stored in post_status.

WordPress Status      What is the content's publish state?
                      draft | pending | private | publish (+ future/trash overlays)
                      Standard WordPress post_status, owned by core. Every stage declares
                      the status region it lives in (per-stage `status` field); status is
                      written only when a transition crosses a region boundary. Same-region
                      moves never touch post_status, so a workflow can define POST-PUBLISH
                      stages (e.g. promote) inside the publish region.
```

> ** (stage × status matrix):** Editorial Status used to be mirrored
> into `post_status` as a registered custom status (`wf1_draft`, …). That is gone.
> `post_status` only ever takes core values and stages intersect it as a matrix:
> every stage lives inside exactly one **status region** (per-stage `status` field:
> `draft` | `pending` | `private` | `publish`; default `draft`), and each region a
> sequence uses has exactly one **entry stage** (`region_entry: true`, its
> checkpoint) — **where a post lands when something outside the workflow puts it
> in that region.** Two rules replace the old projection:
>
> 1. **Workflow-driven (effect semantics):** post_status is written *only* by a
>    transition whose edge crosses a region boundary — written through core
>    (`wp_update_post`), with core's committed answer read back and accepted
>    (`publish` → `future` coercion for scheduled posts included). Same-region
>    moves never touch post_status. A crossing edge may target **any** stage in
>    the target region, and leaving a region is unconstrained too, so "send this
>    back to the desk for revisions" names the stage where work resumes.
> 2. **Core-driven (checkpoint semantics):** users with the core capability may
>    still change status through core UI/REST/CLI; the workflow never fights it —
>    it re-seats the post at the target region's entry stage. Stage-change events
>    carry a cause stamp (`workflow` edge traversal vs `core` checkpoint reseat).
>    `assign_sequence()` seats there too, and **only** there — it takes no stage
>    argument and never writes post_status. If the sequence models no stage in the
>    post's region, the assignment is **refused**: starting a workflow never moves
>    a post to make room for itself, least of all a scheduled post, whose
>    publish-region seat would otherwise be reached by unscheduling it. The author
>    changes the status or picks a sequence that covers it. Crossings are
>    `transition()`'s business, where `current_user_can_cross_region()` polices
>    them; entering a workflow is not a crossing, so assignment needs no
>    permission gate of its own — the invariant is structural.
>
> Rule 2 is `region_entry`'s only job: it is the fallback landing spot, not a
> funnel every entry passes through. An edge that lands mid-region skips whatever
> `status.{stage}.entered` effects the checkpoint owns, which is the author's
> choice to make — see
> [open-region-crossings](../shipped/open-region-crossings.md) for why that
> constraint was removed, and for the region-scoped entered event that is the
> right way to express "run this whenever anything enters pending".
>
> `future` and `trash` are **overlays**, not regions: the workflow never writes or
> reverts them. A publish-region post held as `future` is "in transit"; trash
> suspends the workflow in place (transitions on trashed posts are rejected;
> untrash re-seats via rule 2). There is no divergence state and no capability
> escalation — crossing into a region requires the core capability for that status
> (resolved via the post type's cap object), so a workflow edge never grants a
> status change the user's role couldn't make through core. All stage-based
> querying goes through the `StageQuery` seam, so the storage choice (post meta
> today) stays swappable. This is what unlocks post-publish stages and removes the
> Trac #12706 / block-editor custom-status fragility. The same model also
> supports workflows that need parallel lanes within a region.

## Entry Points

Content can enter at any level. The story is always created automatically.

```
Entry via ideation seed:    Story created -> Ideation project created
                            Story status: ideation

Entry via direct article:   Story created -> Article created
                            Story status: editorial
```

## The Flywheel

```
                    ┌──────────────────────────────┐
                    │                              │
                    ▼                              │
              ┌──────────┐                         │
              │ Ideation │                         │
              └────┬─────┘                         │
                   │                               │
            ┌──────▼───────┐                       │
            │  Production  │                       │
            └──────┬───────┘                       │
                   │                               │
            ┌──────▼───────┐                       │
            │  Published   │                       │
            └──────┬───────┘                       │
                   │                               │
            ┌──────▼───────┐    new story          │
            │  Monitoring  ├───────────────────────┘
            └──────┬───────┘
                   │
            ┌──────▼───────┐
            │   Refresh    │
            └──────┬───────┘
                   │
                   ├── back to Ideation (need new research)
                   └── back to Editorial (edit existing article)
```

Post-publish monitoring analyzes performance, competitive landscape, and content decay.

**From refresh, a story can go back to any earlier stage:**
- **Back to `ideation`**: the topic needs fresh research before deciding what to do.
- **Back to `editorial`**: the existing article just needs updates (new stats, corrected information, expanded sections). The article re-enters its editorial workflow.

**Or spawn a new story entirely**: monitoring identifies a new topic opportunity. A new story is created, pre-seeded with context from the original. The new story enters at ideation and the cycle continues.
