# Workflow Checklist Tool

Customizable checklist for workflow transitions. Define items that must be checked before proceeding to the next workflow state.

## Features

- ✅ **Custom Checklist Items** - Define any checklist items you need
- 🔒 **Hard/Soft Requirements** - Block transitions or show warnings
- 📝 **Per-Post State** - Track checklist progress on each post
- 🎯 **Editor Integration** - Checklist appears in post editor sidebar
- 🔄 **Workflow Integration** - Available as transition ability

## Installation

1. Requires **VIP Workflows** plugin
2. Activate this plugin
3. Configure checklist items in **VIP Workflows → Integrations → Tools**

## Configuration

Navigate to **VIP Workflows → Integrations → Tools** to configure checklist items:

**Checklist Items:**

Each item has:
- **Label**: The text displayed to the user
- **Required**: Whether this item is mandatory (hard) or optional (soft)

**Example Configuration:**

```
☑️ SEO meta description added (Required)
☑️ Featured image uploaded (Required)
☑️ Categories assigned (Required)
☑️ Internal links added (Optional)
☑️ Social media preview checked (Optional)
```

**Hard vs Soft:**
- **Hard** (required): Must be checked to proceed with transition
- **Soft** (optional): Shows warning if unchecked but allows transition

## Usage

### In Post Editor

1. Open any post/page in the editor
2. Look for the **Checklist** panel in the sidebar
3. Check items as you complete them
4. Progress persists per post

### In Workflow Transitions

The checklist appears as an available ability during transitions:

1. Attempt to transition to another state
2. Checklist evaluates checked items
3. If required items unchecked → transition blocked
4. If optional items unchecked → warning shown

### Via REST API

**Get checklist items:**

```bash
GET /wp-json/workflow-tool-checklist/v1/items
```

**Save checklist items (admin):**

```bash
POST /wp-json/workflow-tool-checklist/v1/items

[
  {
    "id": "seo-meta",
    "label": "SEO meta description added",
    "required": true
  }
]
```

**Get checked items for a post:**

```bash
GET /wp-json/workflow-tool-checklist/v1/post/{post_id}/checked
```

**Save checked items for a post:**

```bash
POST /wp-json/workflow-tool-checklist/v1/post/{post_id}/checked

{
  "checked": ["seo-meta", "featured-image"]
}
```

## Output

The ability returns:

```json
{
  "passed": true,
  "status": "pass",
  "summary": "All required checklist items have been completed.",
  "message": "All required checklist items have been completed.",
  "items": [
    {
      "id": "seo-meta",
      "label": "SEO meta description added",
      "required": true,
      "checked": true,
      "passed": true
    },
    {
      "id": "internal-links",
      "label": "Internal links added",
      "required": false,
      "checked": false,
      "passed": true
    }
  ],
  "issues": []
}
```

**Status values:**
- `pass`: All required items checked
- `fail`: Required items unchecked (blocks transition)

## Requirements

- WordPress VIP
- VIP Workflows plugin

## Development

Demonstrates the Tool/Ability extension pattern. Tools register with the WordPress Abilities API and appear in the VIP Workflows Tools tab.
