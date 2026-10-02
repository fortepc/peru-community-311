# Peru Community 311

Peru Community 311 is an open-source, citizen-built civic reporting portal for Peru, Indiana. Residents can map non-emergency issues and prepare reports for the department or service responsible.

> **Disclaimer:** Peru Community 311 is an independent community initiative. It is not owned, operated, or managed by the City of Peru or Miami County government offices.

## How It Works

1. Pin an issue on the Leaflet map or use the device's location.
2. Choose an issue category and complete its questionnaire.
3. Select **Review & Report** to review the report and the category's available department contact information.
4. Submit the report to the department by email, official web portal, or phone. This version does not save reports to this website or submit them to an agency.

The browser emits a `report-action` custom event when someone chooses **Send as email**, opens an official web portal, or calls a department. Its `detail` contains `action` (`send_email`, `open_webform`, or `call_department`), `categoryId`, and a `reportDraftId` shared by actions taken in the same report dialog. This event is an integration point for future analytics; no actions or reports are currently stored.

## Configure `templates.json`

The app loads `templates.json` when it starts. Edit this file to change the map defaults, categories, questions, and report destinations.

### Location Defaults

The top-level `location` object controls the initial map view:

- `city`, `county`, and `state` describe the service area.
- `defaultCenter.lat` and `defaultCenter.lng` set the initial map coordinates.
- `defaultZoom` sets the initial map zoom level.

For example, this configuration opens the map near Peru at zoom level 14:

```json
{
   "location": {
      "city": "Peru",
      "county": "Miami County",
      "state": "IN",
      "defaultCenter": {
         "lat": 40.7537,
         "lng": -86.0689
      },
      "defaultZoom": 14
   }
}
```

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

Categories can also optionally include an `emergency` object to trigger the flashing emergency mode in the app. Use `enabled: true` for categories that should always trigger emergency mode, or provide a `keywords` array for answer text that should trigger the alert when selected. The app will still use the category's phone number for the emergency call button.

Here is an example category object to add to the `categories` array. Replace the sample contact details with verified information:

```json
{
   "id": "street_surface",
   "name": "Street Surface Issues",
   "department": "Street Department",
   "description": "Report potholes and debris on public streets.",
   "emergency": {
      "keywords": ["active water main break", "sparking wire"]
   },
   "emailSubjectTemplate": "Street issue: {location}",
   "emailTemplate": "Please inspect this street issue.\nLocation: {location}\nIssue: {question:details}\nMap: {mapsUrl}",
   "destinations": {
      "email": "street-dept@example.gov",
      "phone": "(765) 555-0100",
      "webformUrl": null,
      "socialUrl": null,
      "address": "123 Main St, Peru, IN"
   },
   "questions": [
      {
         "id": "details",
         "label": "Describe the issue",
         "type": "textarea",
         "required": true,
         "placeholder": "Include the nearest address or intersection."
      }
   ]
}
```

### Questionnaire Fields

Each object in a category's `questions` array defines one input:

- `id`: Unique identifier within that category. It also lets an email template refer to this answer.
- `label`: Text shown beside the input and used as its label in `{answers}`.
- `type`: `select`, `text`, or `textarea`.
- `required`: Whether the field is required before sending or copying the report. Enforced with inline validation.
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

The top-level `emailSubjectTemplate` controls the mailto subject, and `emailTemplate` controls the message body used by both **Send as email** and **Copy report**. A category can optionally set `emailSubjectTemplate` and/or `emailTemplate` to override either setting. The default subject is `Civic Report: {category} - {location}`. In JSON strings, write `\n` in the body template where a line break should appear.

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

For example, these top-level settings create a short subject and a multi-line message body:

```json
{
   "emailSubjectTemplate": "Report: {category} at {location}",
   "emailTemplate": "CIVIC REPORT: {category}\nDepartment: {department}\nLocation: {location}\nIssue: {question:surface_issue}\nDetails: {question:details}\nMap: {mapsUrl}"
}
```

A category can override either value by including `emailSubjectTemplate` or `emailTemplate` in that category object.
