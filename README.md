# Peru Community 311

Peru Community 311 is an open-source, citizen-built civic reporting portal for Peru, Indiana. Residents can map non-emergency issues and prepare reports for the department or service responsible.

> **Disclaimer:** Peru Community 311 is an independent community initiative. It is not owned, operated, or managed by the City of Peru or Miami County government offices.

## How It Works

1. Pin an issue on the Leaflet map or use the device's location.
2. Choose an issue category and complete its questionnaire.
3. Send a prefilled report by email, copy its text, call a department, or open the configured web or social link.

## Configure `templates.json`

The app loads `templates.json` when it starts. Edit this file to change the map defaults, categories, questions, and report destinations.

### Location Defaults

The top-level `location` object controls the initial map view:

- `city`, `county`, and `state` describe the service area.
- `defaultCenter.lat` and `defaultCenter.lng` set the initial map coordinates.
- `defaultZoom` sets the initial map zoom level.

### Categories

Each object in the top-level `categories` array describes one report option. Add a new object to the array or edit an existing one. Each category can contain:

- `id`: Stable identifier for the category. Keep it unique; category-specific email templates and icon selection use it.
- `name`: User-facing category name.
- `department`: Department or organization shown as responsible.
- `description`: Short explanation shown in the category list.
- `destinations`: Contact and follow-up links for this category.
- `questions`: The fields residents answer for this category.
- `emailSubjectTemplate`: Optional subject template that overrides the top-level setting for this category.
- `emailTemplate`: Optional message-body template that overrides the top-level setting for this category.

The `destinations` object supports `email`, `phone`, `webformUrl`, `socialUrl`, and `address`. The email button uses `email`; the call button uses `phone`; and the extra links use `webformUrl` and `socialUrl`. Use `null` for a destination that is not available. A configured `address` is shown on the category card as location/contact information; confirm with the destination whether it accepts in-person reports.

### Questionnaire Fields

Each object in a category's `questions` array defines one input:

- `id`: Unique identifier within that category. It also lets an email template refer to this answer.
- `label`: Text shown beside the input and used as its label in `{answers}`.
- `type`: `select`, `text`, or `textarea`.
- `required`: Whether the interface displays an asterisk beside the label. This currently does not prevent a report from being sent when the field is empty.
- `placeholder`: Optional hint for `text` and `textarea` inputs.
- `options`: Required for `select`; an array of the choices to show.

For example, a short category-specific question can be configured like this:

```json
{
   "id": "surface_issue",
   "label": "What needs attention?",
   "type": "select",
   "required": true,
   "options": ["Pothole", "Debris", "Other"]
}
```

When adding a question, give it a unique `id` and make sure select questions have at least one option. Use `text` for a single-line answer and `textarea` for longer details.

## Email Message Templates

The top-level `emailSubjectTemplate` controls the mailto subject, and `emailTemplate` controls the message body used by both **Send Report via Email** and **Copy Text**. A category can optionally set `emailSubjectTemplate` and/or `emailTemplate` to override either setting. The default subject is `Civic Report: {category} - {location}`. In JSON strings, write `\n` in the body template where a line break should appear.

Available placeholders:

| Placeholder | Value |
| --- | --- |
| `{category}` | Selected category name |
| `{department}` | Department assigned to the category |
| `{location}` | Selected address or coordinate fallback |
| `{latitude}` | Selected latitude |
| `{longitude}` | Selected longitude |
| `{mapsUrl}` | Google Maps URL for the selected coordinates |
| `{answers}` | All questionnaire answers, formatted with their labels |
| `{question:question_id}` | One answer, using its `id` from the category's `questions` list |

These placeholders are supported in both subject and body templates. For example, `{question:surface_issue}` inserts the answer to the `surface_issue` question. Empty answers and unknown question IDs become `N/A`. Unrecognized placeholders remain unchanged so configuration mistakes are visible.
