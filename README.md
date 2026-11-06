# Community 311

This open-source, citizen-run 311 alternative was originally built for Peru, Indiana. The repository includes that deployment as example data; communities can fork the project and replace the city configuration, report categories, contacts, and service boundaries.

## Live Deployment

https://fortepc.github.io/peru-community-311/

> **Disclaimer:** The original Peru Community 311 deployment is an independent community initiative. It is not owned, operated, or managed by the City of Peru or Miami County government offices.

## How It Works

1. A resident pins an issue on the Leaflet map or uses the device location.
2. The resident selects an applicable category and answers its questions.
3. The resident selects **Save Report** to send the report to the deployment's configured temporary Discord inbox.
4. The resident sends the report with a `mailto:` link or submits it through an external agency webform. Phone links are available when configured.

This is a client-side static site with no application server or reporting database. Clicking **Save Report** sends a JSON report attachment directly from the browser to the Discord webhook configured in `config.json`; the report includes its text, category, department, location, coordinates, answers, and submission time. This temporary inbox is not a searchable public map and does not notify the responsible agency. Email is opened in the resident's email application, and webforms are hosted by the destination agency. Opening a link does not confirm that an agency received a report.

The webhook URL is included in public site configuration and can be copied by any visitor. Anyone who obtains it can post to its Discord channel. Use a dedicated channel, restrict channel access, and rotate or remove the webhook when replacing this temporary collection mechanism with a server-side database. The site displays this collection notice before the save action; do not enter sensitive personal information in reports.

## Analytics and Privacy

When `analyticsMeasurementId` is configured, Google Analytics automatically collects page views, broad device-category metrics, allowlisted UTM campaign parameters (`utm_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_source_platform`, `utm_creative_format`, `utm_marketing_tactic`, `utm_term`, and `utm_content`), and the workflow events described below. There is no in-app opt-in or opt-out control. Remove or leave the Measurement ID empty to disable all analytics for a deployment. The configurator itself does not load or send analytics; it only edits the ID used by the public 311 page.

Baseline page views include `entry_type`: `base_url` for a general visit or `prefilled_report` when the URL contains recognized report coordinates, category, or answer fields. This lets QR campaigns distinguish a general site visit from a prefilled report link.

The site records map-pin sources, selected category IDs, report save attempts, successful or failed saves, and a `report_made` event for each follow-up action. That event includes `category_id` and `action_type` values such as `mailto`, `webform`, `tel`, `copy_report`, `office_directions`, `social_page`, and `emergency_911`. It records the action the visitor chose, not confirmation that the receiving agency got the report. Report text, questionnaire answers, precise coordinates, and report draft IDs are not sent to Google Analytics. Google Analytics may use its analytics cookie and standard browser/device signals to estimate visits and users. Advertising signals and ad personalization are disabled.

For category and funnel breakdowns in GA4 explorations, register event-scoped custom dimensions for `entry_type`, `category_id`, `source`, and `action_type` in **Admin > Data display > Custom definitions**.

Before collecting real traffic, turn **Enhanced measurement off** for this web stream in **Admin > Data streams > your web stream > Enhanced measurement**. Automatic history-change page views can capture this app's draft query string, and automatic outbound-click events can capture the encoded report body in a `mailto:` URL. This app sends its own sanitized page views and workflow events instead.

With Enhanced measurement disabled, the site's page views and workflow events do not send questionnaire answers, report text, precise coordinates, or report draft IDs to Google Analytics. Page-view locations include only the page path and allowlisted UTM tags; other URL query parameters and fragments are excluded because they can contain shared report drafts. UTM values are campaign labels supplied in the inbound link, not on-site search data.

For example, a printed QR code can use a URL like `https://your-site.example/311/?utm_source=qr&utm_medium=print&utm_campaign=neighborhood_flyer&lat=40.75&lng=-86.07&cat=street_sanitation`. Analytics records the QR campaign tags and `entry_type=prefilled_report`, but not the coordinates, category query value, or any answer values from the URL.

The selected location, category, and questionnaire answers are reflected in the page URL so a draft can be shared or reopened. Anyone with that URL can see those values, so do not include sensitive information in a draft. The browser emits a `report-action` custom event for email, webform, and phone actions; it is only an integration point and does not store or count reports.

## How to Deploy for Your City

1. Fork this repository and review it as a static-site template. The included Peru contacts and categories are examples for the original deployment, not verified information for another community.
2. In your fork, open **Settings > Pages**. Choose **Deploy from a branch**, select your publishing branch (usually `main`) and the repository root, then save. GitHub Pages will provide the deployment URL.
3. Edit `config.json` for your city name, county and region, app title, header tagline, page/social descriptions, map center, default zoom, optional Google Analytics Measurement ID, report webhook URL, optional site contact email, repository URL, and deployment URL. Coordinates use latitude and longitude fields. The optional site email is separate from department contacts. Leave `analyticsMeasurementId` empty or omit it to disable analytics. A report webhook is required for the Save Report action to work.
4. Edit `templates.json` to configure the categories, department names, questions, emergency guidance, and report subject/body templates. Put each department's email, phone, and official webform URL in that category's `destinations` object. These destinations are where residents route reports; they are not app-wide contact details.
5. Edit `boundaries.geojson` when a category needs location-based coverage. It is a standard GeoJSON `FeatureCollection`; each boundary is a `Feature` with a unique, stable `properties.id`, a required non-empty `properties.name` that is unique regardless of capitalization, and a `Polygon` geometry. Coordinates are ordered `[longitude, latitude]`, and each ring must close by repeating its first coordinate.
6. In `templates.json`, reference boundary IDs from the category's `jurisdiction` object. The configurator lets you select named boundaries as Allowed or Excluded while saving their stable IDs. `includes` is an array of IDs that define the allowed areas; multiple included areas are combined. `excludes` is an array of IDs that always hide the category inside those areas. With no included IDs, the category is available everywhere except its exclusions. Categories without a `jurisdiction` are unrestricted.
7. Optionally open `configurator.html`. When served beside the deployment files, it loads them automatically on a fresh start; an autosaved browser draft takes precedence. Use **Import / Export** to import or export each file separately or all three together. The editor keeps data in the browser and does not upload it. Individual imports are checked against the other current files before replacing editor data.
8. Verify every destination with the responsible agency, review emergency wording, and test pins inside/outside each boundary. Confirm the GitHub Pages URL and all relative data files work before sharing the site.

`manifest.webmanifest` is a separate static install asset. Its name is generic by default; update its name, short name, and description for a branded install. The service worker caches the app shell and all three runtime data files. Map tiles, reverse geocoding, the CDN libraries, and external webforms still require an internet connection.

## Configuration Files

- `config.json` contains deployment branding, map defaults, page metadata, the optional site contact email, and an optional analytics Measurement ID.
- `templates.json` contains report categories, department destinations, emergency guidance, questions, and email templates. Category jurisdiction stores only boundary ID references.
- `boundaries.geojson` contains the shared Polygon Features referenced by categories.
- `config.schema.json`, `templates.schema.json`, and `boundaries.schema.json` describe the data shapes.

Email templates support `{appTitle}`, `{category}`, `{department}`, `{location}`, `{latitude}`, `{longitude}`, `{mapsUrl}`, `{answers}`, and `{question:question_id}`. Category-specific templates can override the top-level email subject or body.

## Install on a Phone

Publish over HTTPS, then open the site in the phone's browser. On Android, use **Install app** or **Add to Home screen**. On iPhone or iPad, open Safari's Share menu and choose **Add to Home Screen**. The app shell is cached after the first successful visit, but the live map, address lookup, CDN libraries, and external reporting destinations require internet access.

## Repository Structure

- `index.html`, `styles.css`, and `app.js` are the reusable application interface and client-side engine.
- `config.json`, `templates.json`, and `boundaries.geojson` are deployment-specific data.
- `configurator.html` is a standalone editor for all three data files.
- `service-worker.js`, `manifest.webmanifest`, and `icons/` provide offline app-shell caching and install metadata.
- `*.schema.json` files describe the configuration and GeoJSON structures.
- `LICENSE` contains the project's license.

Map tiles and address lookup use OpenStreetMap services. Retain appropriate attribution and follow the services' usage policies for your deployment.
