# Community 311

This open-source, citizen-run 311 alternative was originally built for Peru, Indiana. The repository includes that deployment as example data; communities can fork the project and replace the city configuration, report categories, contacts, and service boundaries.

## Live Deployment

https://fortepc.github.io/peru-community-311/

> **Disclaimer:** The original Peru Community 311 deployment is an independent community initiative. It is not owned, operated, or managed by the City of Peru or Miami County government offices.

## How It Works

1. A resident pins an issue on the Leaflet map or uses the device location.
2. The resident selects an applicable category and answers its questions.
3. The app builds a report for review and presents the category's configured contact methods.
4. The resident sends the report with a `mailto:` link or submits it through an external agency webform. Phone links are available when configured.

This is a stateless, client-side static site. It has no application server or reporting database: reports are not submitted to or stored by this website. Email is opened in the resident's email application, and webforms are hosted by the destination agency. Opening a link does not confirm that an agency received a report.

The selected location, category, and questionnaire answers are reflected in the page URL so a draft can be shared or reopened. Anyone with that URL can see those values, so do not include sensitive information in a draft. The browser emits a `report-action` custom event for email, webform, and phone actions; it is only an integration point and does not store or count reports.

## How to Deploy for Your City

1. Fork this repository and review it as a static-site template. The included Peru contacts and categories are examples for the original deployment, not verified information for another community.
2. In your fork, open **Settings > Pages**. Choose **Deploy from a branch**, select your publishing branch (usually `main`) and the repository root, then save. GitHub Pages will provide the deployment URL.
3. Edit `config.json` for your city name, county and region, app title, header tagline, page/social descriptions, map center, default zoom, optional site contact email, repository URL, and deployment URL. Coordinates use latitude and longitude fields. The optional site email is separate from department contacts.
4. Edit `templates.json` to configure the categories, department names, questions, emergency guidance, and report subject/body templates. Put each department's email, phone, and official webform URL in that category's `destinations` object. These destinations are where residents route reports; they are not app-wide contact details.
5. Edit `boundaries.geojson` when a category needs location-based coverage. It is a standard GeoJSON `FeatureCollection`; each boundary is a `Feature` with a unique, stable `properties.id` and a `Polygon` geometry. Coordinates are ordered `[longitude, latitude]`, and each ring must close by repeating its first coordinate.
6. In `templates.json`, reference boundary IDs from the category's `jurisdiction` object. `includes` is an array of IDs that define the allowed areas; multiple included areas are combined. `excludes` is an array of IDs that always hide the category inside those areas. With no included IDs, the category is available everywhere except its exclusions. Categories without a `jurisdiction` are unrestricted.
7. Optionally open `configurator.html`, import `config.json`, `templates.json`, and `boundaries.geojson` together, edit the settings/categories/boundaries, and download the three updated files. The editor keeps data in the browser and does not upload it.
8. Verify every destination with the responsible agency, review emergency wording, and test pins inside/outside each boundary. Confirm the GitHub Pages URL and all relative data files work before sharing the site.

`manifest.webmanifest` is a separate static install asset. Its name is generic by default; update its name, short name, and description for a branded install. The service worker caches the app shell and all three runtime data files. Map tiles, reverse geocoding, the CDN libraries, and external webforms still require an internet connection.

## Configuration Files

- `config.json` contains deployment branding, map defaults, page metadata, and the optional site contact email.
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
