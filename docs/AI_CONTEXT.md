# AI context index

Use the smallest reference that covers the task:

| Reference | Scope |
| --- | --- |
| [Architecture](reference/architecture.md) | Core concepts, modules, sequences, ideation, tools, agents, notifications, jobs, and events |
| [File structure](reference/file-structure.md) | Directory and subsystem map |
| [Database schema](reference/database-schema.md) | Custom tables and post-meta keys |
| [Data flows](reference/data-flows.md) | Runtime sequences for transitions, tools, media, notifications, and jobs |
| [Code patterns](reference/code-patterns.md) | PHP and JavaScript implementation examples |
| [Admin UI](reference/admin-ui.md) | React applications and admin surfaces |
| [Extension points](reference/extension-points.md) | Hooks, registries, modules, tools, providers, and REST extensions |
| [Quick reference](reference/quick-reference.md) | Common APIs, hooks, endpoints, and debugging queries |
| [AI models](reference/ai-supported-models.md) | Provider support and AI failure modes |

Read the relevant source and tests before changing behavior. Required data remains required: report malformed state rather than adding silent fallback or repair logic. Shared functionality belongs in `vip-workflow/includes/integrations/`, and generated assets under `vip-workflow/build/` are not edited directly.
