/**
 * Community 311 - Main Application Script
 * 
 * This file drives the interactive citizen reporting portal:
 * - Map interactions & reverse geocoding via Leaflet and OpenStreetMap
 * - Dynamic category loading and questionnaire rendering from templates.json
 * - Acute emergency detection & redirection to emergency dispatch/911
 * - Draft URL synchronization for report sharing
 * - Accessible dialog and clipboard/email dispatch formatting
 * 
 * Zero build tools required.
 */

// =============================================================================
// Application State & Configuration
// =============================================================================

let appConfig = null;
let siteConfig = null;
let boundariesById = new Map();
let map, marker;
let selectedCoords = { lat: 0, lng: 0 };
let selectedAddress = "";
let selectedCategoryId = null;
let reportDraftId = null;
let applyingUrlState = false;
let deferredInstallPrompt = null;
const analyticsConsentKey = "community_311_usage_analytics_consent";
let analyticsConsent = null;
let analyticsInitialized = false;

let reverseGeocodeTimer = null;
let reverseGeocodeAbort = null;

const defaultEmailTemplate = `CIVIC REPORT: {category}
Department: {department}
Location: {location}
Coordinates: {mapsUrl}
--------------------------------------------------

{answers}

--------------------------------------------------
Report generated via {appTitle} (open-source citizen portal)`;

const defaultEmailSubjectTemplate = "Civic Report: {category} - {location}";

const defaultEmergencyKeywords = [
  "evacuate",
  "emergency (call",
  "sparking wire",
  "active water main break"
];

function categoryMatchesJurisdiction(category, lat, lng) {
  if (!category || !category.jurisdiction) return true;

  const includes = Array.isArray(category.jurisdiction.includes) ? category.jurisdiction.includes : [];
  const excludes = Array.isArray(category.jurisdiction.excludes) ? category.jurisdiction.excludes : [];
  const point = window.turf.point([lng, lat]);
  const inAllowed = includes.length === 0 || includes.some((id) =>
    window.turf.booleanPointInPolygon(point, boundariesById.get(id))
  );
  const inExcluded = excludes.some((id) =>
    window.turf.booleanPointInPolygon(point, boundariesById.get(id))
  );

  if (!inAllowed) return false;
  return !inExcluded;
}

function getCategoryIconMarkup(icon) {
  const defaultIcon = "fa-circle-info";
  if (typeof icon !== "string" || !icon.trim()) return `<i class="fa-solid ${defaultIcon}"></i>`;

  const escapeAttribute = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const allowedStyleProperties = new Set([
    "color", "fill", "font-size", "font-weight", "line-height", "opacity", "stroke", "stroke-width", "transform", "transform-origin", "vertical-align", "width", "height"
  ]);
  const safeStyle = (styleDeclaration) => {
    const safeRules = [];
    for (let index = 0; index < styleDeclaration.length; index += 1) {
      const property = styleDeclaration[index].toLowerCase();
      const value = styleDeclaration.getPropertyValue(property).trim();
      const isFontAwesomeVariable = /^--fa-[a-z0-9-]+$/.test(property);
      if (!value || /url\s*\(|expression\s*\(|javascript:|[<>;{}]/i.test(value)) continue;
      if (isFontAwesomeVariable || (allowedStyleProperties.has(property) && window.CSS?.supports(property, value))) {
        safeRules.push(`${property}:${value}`);
      }
    }
    return safeRules.join(";");
  };
  const escapeText = (value) => value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
  const safeClasses = (element) => Array.from(element.classList).filter((token) =>
    /^(?:fa(?:-[a-z0-9-]+)?|svg-inline--fa)$/.test(token)
  );
  const serializeIconElement = (element) => {
    const tag = element.tagName.toLowerCase();
    const allowedTags = new Set(["i", "span", "div", "svg", "g", "path", "defs", "mask", "clippath", "rect", "circle", "ellipse", "line", "polygon", "polyline", "use", "title"]);
    if (!allowedTags.has(tag) || (tag === "div" && !element.classList.contains("fa-layers"))) return "";

    const attributes = [];
    const classes = safeClasses(element);
    if (classes.length) attributes.push(`class="${escapeAttribute(classes.join(" "))}"`);
    const style = safeStyle(element.style);
    if (style) attributes.push(`style="${escapeAttribute(style)}"`);

    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      const isAccessibilityAttribute = ["aria-hidden", "role", "title", "focusable"].includes(name);
      const isFontAwesomeData = /^data-fa-[a-z0-9-]+$/.test(name);
      const isSvgAttribute = [
        "viewbox", "xmlns", "fill-rule", "clip-rule", "stroke-width", "stroke-linecap", "stroke-linejoin",
        "d", "transform", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "width", "height", "points",
        "preserveaspectratio", "opacity", "fill-opacity", "stroke-opacity", "id", "data-prefix", "data-icon"
      ].includes(name);
      const isLocalReference = ["href", "xlink:href"].includes(name) && /^#[a-zA-Z0-9_-]+$/.test(value);
      const isSvgPaint = ["fill", "stroke"].includes(name) && (value === "none" || value === "currentColor" || window.CSS?.supports("color", value));
      const isSvgPaintReference = ["fill", "stroke", "mask", "clip-path"].includes(name) && /^url\(#[a-zA-Z0-9_-]+\)$/.test(value);
      if (name === "class" || name === "style") continue;
      if (isAccessibilityAttribute || isFontAwesomeData || isSvgAttribute || isLocalReference || isSvgPaint || isSvgPaintReference) {
        attributes.push(`${name}="${escapeAttribute(value)}"`);
      }
    }

    const children = Array.from(element.childNodes).map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent || "");
      if (node.nodeType === Node.ELEMENT_NODE) return serializeIconElement(node);
      return "";
    }).join("");
    return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>${children}</${tag}>`;
  };

  if (icon.includes("<")) {
    const parsed = new DOMParser().parseFromString(icon, "text/html");
    const iconElement = parsed.body.querySelector("svg, i, .fa-layers, span[class]");
    const markup = iconElement && serializeIconElement(iconElement);
    return markup || `<i class="fa-solid ${defaultIcon}"></i>`;
  }

  const classes = icon.trim().split(/\s+/).map((token) => token.startsWith("fa-") || token === "fa" ? token : `fa-${token}`)
    .filter((token) => /^(?:fa(?:-[a-z0-9-]+)?)$/.test(token));
  const familyToken = /^(?:fa|fa-(?:solid|regular|brands|light|thin|duotone|sharp|classic|kit)(?:-[a-z0-9-]+)?)$/;
  const utilityToken = /^fa-(?:fw|spin|pulse|beat|bounce|fade|flip|shake|border|inverse|stack|xs|sm|lg|xl|2xs|2xl|rotate-[a-z0-9-]+|flip-[a-z0-9-]+)$/;
  if (!classes.some((token) => !familyToken.test(token) && !utilityToken.test(token))) classes.push(defaultIcon);
  if (!classes.some((token) => familyToken.test(token))) classes.push("fa-solid");
  return `<i class="${escapeAttribute([...new Set(classes)].join(" "))}"></i>`;
}

// =============================================================================
// Helper: Screen Reader Live Announcements
// =============================================================================

function announceToScreenReader(message) {
  const liveRegion = document.getElementById("a11y-live-region");
  if (liveRegion) {
    liveRegion.textContent = "";
    // Short timeout ensures screen readers register the text change
    setTimeout(() => {
      liveRegion.textContent = message;
    }, 50);
  }
}

// =============================================================================
// Progressive Web App (PWA) Install Handling
// =============================================================================

const installAppButton = document.getElementById("install-app-btn");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installAppButton) installAppButton.classList.add("hidden");
});

if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
  if (installAppButton) installAppButton.classList.add("hidden");
}

if (installAppButton) {
  installAppButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      alert("To install this app, open your browser menu and choose 'Install app' or 'Add to Home Screen'.");
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
}

// Scroll smoothly to form section on mobile
function scrollToReportForm() {
  const formSection = document.getElementById("report-form-section");
  if (formSection) {
    formSection.scrollIntoView({ behavior: "smooth" });
  }
}

// =============================================================================
// Application Initialization
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  const initialParams = new URLSearchParams(window.location.search);
  try {
    await loadTemplates();
  } catch (error) {
    showInitializationError(error);
    return;
  }
  initMap();
  setupEventListeners();
  setupMobileObserver();
  applyURLState(initialParams);

  // Register offline Service Worker if supported and running in secure context
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Unable to register the app service worker.", error);
    });
  }
});

// =============================================================================
// URL Parameter Synchronization (Permalinks & Sharing)
// =============================================================================

function applyURLState(params) {
  applyingUrlState = true;

  const latValue = params.get("lat");
  const lngValue = params.get("lng");
  const lat = Number(latValue);
  const lng = Number(lngValue);
  const hasCoordinates = params.has("lat") && params.has("lng") &&
    latValue.trim() !== "" && lngValue.trim() !== "" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  if (hasCoordinates) {
    map.setView([lat, lng], 16);
    setMarker(lat, lng, "shared_link");
  }

  const requestedCategory = params.get("cat");
  if (requestedCategory !== null && appConfig && appConfig.categories) {
    const requestedIndex = Number(requestedCategory);
    const category = appConfig.categories.find((item) => String(item.id) === requestedCategory) ||
      (Number.isInteger(requestedIndex) && requestedIndex > 0 ? appConfig.categories[requestedIndex - 1] : null);
    if (category) selectCategory(category.id);
  }

  const form = document.getElementById("dynamic-form");
  if (selectedCategoryId !== null && form) {
    params.forEach((value, key) => {
      if (key === "lat" || key === "lng" || key === "cat") return;
      const input = Array.from(form.elements).find((element) =>
        element.name === key || element.id === key || element.dataset.field === key
      );
      if (input) input.value = value;
    });
    updateDispatchOutput();
  }

  applyingUrlState = false;
  syncStateToURL();
}

function syncStateToURL() {
  if (applyingUrlState || !appConfig) return;

  const url = new URL(window.location.href);
  const params = url.searchParams;
  params.delete("lat");
  params.delete("lng");
  params.delete("cat");

  const knownQuestionKeys = new Set();
  appConfig.categories.forEach((category) => {
    category.questions.forEach((question) => {
      knownQuestionKeys.add(String(question.id));
      knownQuestionKeys.add(`q-${category.id}-${question.id}`);
      if (question.name) knownQuestionKeys.add(question.name);
      if (question.field) knownQuestionKeys.add(question.field);
    });
  });
  knownQuestionKeys.forEach((key) => params.delete(key));

  params.set("lat", selectedCoords.lat.toFixed(6));
  params.set("lng", selectedCoords.lng.toFixed(6));
  if (selectedCategoryId !== null) params.set("cat", selectedCategoryId);

  if (selectedCategoryId !== null) {
    document.querySelectorAll("#dynamic-form input, #dynamic-form select, #dynamic-form textarea").forEach((input) => {
      const key = input.name || input.dataset.field || input.dataset.questionId;
      if (key && input.value.trim()) params.set(key, input.value);
    });
  }

  const query = params.toString();
  window.history.replaceState(null, "", `${url.pathname}${query ? `?${query}` : ""}${url.hash}`);
}

// =============================================================================
// Templates Loading & Parsing
// =============================================================================

async function loadTemplates() {
  const paths = ["./config.json", "./templates.json", "./boundaries.geojson"];
  const responses = await Promise.all(paths.map((path) => fetch(path)));
  const failedIndex = responses.findIndex((response) => !response.ok);
  if (failedIndex !== -1) throw new Error(`Failed to load ${paths[failedIndex]}`);

  const [nextSiteConfig, nextAppConfig, boundaryCollection] = await Promise.all(
    responses.map((response) => response.json())
  );
  if (typeof nextSiteConfig?.cityName !== "string" || !nextSiteConfig.cityName.trim() ||
      typeof nextSiteConfig?.regionName !== "string" || !nextSiteConfig.regionName.trim() ||
      typeof nextSiteConfig?.appTitle !== "string" || !nextSiteConfig.appTitle.trim() ||
      !Number.isFinite(Number(nextSiteConfig?.mapCenter?.lat)) ||
      !Number.isFinite(Number(nextSiteConfig?.mapCenter?.lng)) ||
      !Number.isInteger(nextSiteConfig?.defaultZoom) || nextSiteConfig.defaultZoom < 1 || nextSiteConfig.defaultZoom > 20 ||
      !Array.isArray(nextAppConfig?.categories) ||
      boundaryCollection?.type !== "FeatureCollection" || !Array.isArray(boundaryCollection.features)) {
    throw new Error("The city configuration, templates, or boundary collection has an invalid structure.");
  }
  if (typeof window.turf?.point !== "function" || typeof window.turf?.booleanPointInPolygon !== "function") {
    throw new Error("Turf.js did not load, so jurisdiction boundaries cannot be checked.");
  }
  if (nextSiteConfig.analyticsMeasurementId &&
      !/^G-[A-Z0-9]+$/.test(nextSiteConfig.analyticsMeasurementId)) {
    throw new Error("The Google Analytics Measurement ID must use the G-XXXXXXXXXX format.");
  }

  const nextBoundariesById = new Map();
  for (const feature of boundaryCollection.features) {
    const id = feature?.properties?.id;
    if (typeof id !== "string" || !id || feature?.geometry?.type !== "Polygon" || nextBoundariesById.has(id)) {
      throw new Error("Every boundary must be a Polygon Feature with a unique properties.id.");
    }
    nextBoundariesById.set(id, feature);
  }
  for (const category of nextAppConfig.categories) {
    const jurisdiction = category?.jurisdiction;
    if (jurisdiction && typeof jurisdiction === "object" &&
        ("polygons" in jurisdiction || "excludedPolygons" in jurisdiction)) {
      throw new Error(`Category "${category.id}" uses legacy inline polygons; replace them with boundary IDs.`);
    }
    for (const key of ["includes", "excludes"]) {
      const references = jurisdiction?.[key];
      if (references !== undefined && !Array.isArray(references)) {
        throw new Error(`Category "${category.id}" jurisdiction.${key} must be an array.`);
      }
      for (const id of references || []) {
        if (!nextBoundariesById.has(id)) throw new Error(`Category "${category.id}" references missing boundary "${id}".`);
      }
    }
  }

  siteConfig = nextSiteConfig;
  appConfig = nextAppConfig;
  boundariesById = nextBoundariesById;
  selectedCoords = { lat: Number(siteConfig.mapCenter.lat), lng: Number(siteConfig.mapCenter.lng) };
  selectedAddress = `Center of ${siteConfig.cityName}, ${siteConfig.regionName}`;
  populateConfiguredContent();
  renderCategoryCards();
}

function showInitializationError(error) {
  console.error("Unable to initialize the reporting app.", error);
  const categoryContainer = document.getElementById("category-cards-container");
  if (categoryContainer) categoryContainer.textContent = "The app could not load its city configuration. Please try again later.";
  announceToScreenReader("The app could not load its city configuration.");
}

function populateConfiguredContent() {
  document.title = `${siteConfig.appTitle} - Citizen Issue Reporting`;
  document.getElementById("app-title").textContent = siteConfig.appTitle;
  document.getElementById("app-tagline").textContent = siteConfig.headerTagline;
  document.getElementById("footer-app-title").textContent = siteConfig.appTitle;
  document.getElementById("map").setAttribute("aria-label", `Map showing ${siteConfig.cityName}, ${siteConfig.regionName}`);
  document.getElementById("manual-address-input").placeholder = `Enter nearest address or intersection in ${siteConfig.cityName}, ${siteConfig.regionName}`;
  const repositoryLink = document.getElementById("repository-link");
  if (siteConfig.repositoryUrl) repositoryLink.href = siteConfig.repositoryUrl;
  const siteContactLink = document.getElementById("site-contact-link");
  if (siteConfig.contactEmail) {
    siteContactLink.href = `mailto:${siteConfig.contactEmail}`;
    siteContactLink.classList.remove("hidden");
  }

  document.querySelector('meta[name="apple-mobile-web-app-title"]').content = siteConfig.appTitle;
  document.querySelector('meta[name="description"]').content = siteConfig.pageDescription;
  document.querySelector('meta[property="og:title"]').content = siteConfig.appTitle;
  document.querySelector('meta[property="og:description"]').content = siteConfig.socialDescription;
  document.querySelector('meta[property="og:url"]').content = siteConfig.deploymentUrl || window.location.href;
  setupAnalyticsConsent();
}

function setupAnalyticsConsent() {
  const panel = document.getElementById("analytics-choice-panel");
  const preferencesButton = document.getElementById("analytics-preferences-btn");
  const acceptButton = document.getElementById("analytics-accept-btn");
  const declineButton = document.getElementById("analytics-decline-btn");
  if (!siteConfig.analyticsMeasurementId) {
    panel.classList.add("hidden");
    preferencesButton.classList.add("hidden");
    return;
  }

  let savedChoice = null;
  try {
    savedChoice = localStorage.getItem(analyticsConsentKey);
  } catch (error) {}
  analyticsConsent = savedChoice === "granted" || savedChoice === "denied" ? savedChoice : null;
  panel.classList.toggle("hidden", analyticsConsent !== null);
  initializeAnalytics();

  preferencesButton.addEventListener("click", () => panel.classList.remove("hidden"));
  acceptButton.addEventListener("click", () => setAnalyticsConsent("granted"));
  declineButton.addEventListener("click", () => setAnalyticsConsent("denied"));
}

function setAnalyticsConsent(choice) {
  analyticsConsent = choice;
  try {
    localStorage.setItem(analyticsConsentKey, choice);
  } catch (error) {}
  document.getElementById("analytics-choice-panel").classList.add("hidden");
}

function getAnalyticsEntryContext() {
  const searchParams = new URLSearchParams(window.location.search);
  const utmKeys = [
    "utm_id",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_source_platform",
    "utm_creative_format",
    "utm_marketing_tactic",
    "utm_term",
    "utm_content"
  ];
  const utmParameters = {};
  for (const key of utmKeys) {
    const value = searchParams.get(key)?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
    if (value) utmParameters[key] = value;
  }

  const hasCoordinates = searchParams.has("lat") && searchParams.has("lng");
  const hasCategory = searchParams.has("cat");
  const hasQuestionAnswer = appConfig.categories.some((category) =>
    category.questions.some((question) => [
      String(question.id),
      `q-${category.id}-${question.id}`,
      question.name,
      question.field
    ].some((key) => key && searchParams.has(key)))
  );

  return {
    entryType: hasCoordinates || hasCategory || hasQuestionAnswer ? "prefilled_report" : "base_url",
    utmParameters
  };
}

function initializeAnalytics() {
  const measurementId = siteConfig?.analyticsMeasurementId;
  if (!measurementId || analyticsInitialized) return;
  analyticsInitialized = true;
  const { entryType, utmParameters } = getAnalyticsEntryContext();
  const campaignQuery = new URLSearchParams(utmParameters).toString();
  const pageLocation = `${window.location.origin}${window.location.pathname}${campaignQuery ? `?${campaignQuery}` : ""}`;
  let pageReferrer = "";
  try {
    if (document.referrer) pageReferrer = new URL(document.referrer).origin;
  } catch (error) {}

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied"
  });
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: false,
    page_location: pageLocation,
    page_referrer: pageReferrer,
    page_title: document.title,
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });
  window.gtag("event", "page_view", {
    page_location: pageLocation,
    page_referrer: pageReferrer,
    page_title: document.title,
    entry_type: entryType,
    ...utmParameters
  });

  const script = document.createElement("script");
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.onerror = () => {
    analyticsInitialized = false;
    console.warn("Unable to load Google Analytics.");
  };
  document.head.appendChild(script);
}

function trackAnalyticsEvent(eventName, parameters) {
  if (analyticsConsent === "granted" && typeof window.gtag === "function") {
    window.gtag("event", eventName, parameters);
  }
}

// =============================================================================
// Map & Geocoding Logic (Leaflet + Nominatim)
// =============================================================================

function initMap() {
  const center = siteConfig.mapCenter;
  const zoom = siteConfig.defaultZoom;

  map = L.map("map").setView([center.lat, center.lng], zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
  }).addTo(map);

  marker = L.marker([center.lat, center.lng], { draggable: true }).addTo(map);

  map.on("click", (e) => setMarker(e.latlng.lat, e.latlng.lng, "map_click"));
  marker.on("dragend", (e) => {
    const pos = e.target.getLatLng();
    setMarker(pos.lat, pos.lng, "marker_drag");
  });

  reverseGeocode(center.lat, center.lng);
}

function setMarker(lat, lng, source = "manual") {
  selectedCoords = { lat, lng };
  trackAnalyticsEvent("location_pin_set", { source });
  marker.setLatLng([lat, lng]);
  renderCategoryCards();
  if (selectedCategoryId && !appConfig?.categories?.some((cat) => cat.id === selectedCategoryId && categoryMatchesJurisdiction(cat, lat, lng))) {
    resetCategorySelection();
  }
  if (reverseGeocodeAbort) reverseGeocodeAbort.abort();
  debouncedReverseGeocode(lat, lng);
  syncStateToURL();
}

function debouncedReverseGeocode(lat, lng) {
  clearTimeout(reverseGeocodeTimer);
  reverseGeocodeTimer = setTimeout(() => {
    reverseGeocode(lat, lng);
  }, 350);
}

async function reverseGeocode(lat, lng) {
  const display = document.getElementById("address-display");
  if (display) display.textContent = "Finding address...";

  if (reverseGeocodeAbort) {
    reverseGeocodeAbort.abort();
  }
  reverseGeocodeAbort = new AbortController();

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
      signal: reverseGeocodeAbort.signal,
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) throw new Error("Geocoding service unavailable");
    const data = await res.json();
    selectedAddress = data.display_name ? data.display_name.split(",").slice(0, 3).join(",") : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (e) {
    if (e.name === "AbortError") return;
    selectedAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  if (display) {
    display.textContent = selectedAddress;
    display.title = selectedAddress;
  }
  announceToScreenReader(`Selected location updated to ${selectedAddress}`);
  updateDispatchOutput();
}

// =============================================================================
// Category Rendering & Selection
// =============================================================================

function renderCategoryCards() {
  const container = document.getElementById("category-cards-container");
  if (!container || !appConfig || !appConfig.categories) return;
  container.innerHTML = "";

  const visibleCategories = appConfig.categories.filter((cat) => categoryMatchesJurisdiction(cat, selectedCoords.lat, selectedCoords.lng));
  if (selectedCategoryId && !visibleCategories.some((cat) => cat.id === selectedCategoryId)) {
    selectedCategoryId = null;
    resetCategorySelection();
  }

  // Set ARIA listbox role on container
  container.setAttribute("role", "listbox");
  container.setAttribute("aria-label", "Issue Categories");

  visibleCategories.forEach((cat) => {
    const card = document.createElement("div");
    card.className = "category-card border border-gray-200 rounded-lg p-3 cursor-pointer hover:border-indigo-300 hover:bg-gray-50 flex items-start space-x-3 transition";
    card.dataset.id = cat.id;
    card.setAttribute("role", "option");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-selected", "false");

    const iconMarkup = getCategoryIconMarkup(cat.icon);
    const descriptionHtml = cat.description 
      ? `<p class="text-[11px] text-gray-500 mt-1 leading-snug">${cat.description}</p>`
      : "";
    const addressHtml = (cat.destinations && cat.destinations.address)
      ? `<div class="text-[10px] text-gray-500 mt-1.5 flex items-start space-x-1.5"><i class="fa-solid fa-location-dot text-gray-400 mt-px flex-shrink-0" aria-hidden="true"></i><span class="min-w-0 break-words">Address: ${cat.destinations.address}</span></div>`
      : "";
    
    const hasEmail = cat.destinations && cat.destinations.email;
    const hasPhone = cat.destinations && cat.destinations.phone;

    card.innerHTML = `
      <div class="bg-indigo-50 text-indigo-600 p-2.5 rounded-lg text-sm flex-shrink-0 mt-0.5" aria-hidden="true">
        ${iconMarkup}
      </div>
      <div class="flex-grow min-w-0">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold text-gray-900 truncate">${cat.name}</h3>
          <i class="fa-solid fa-circle-check text-indigo-600 hidden select-check text-xs" aria-hidden="true"></i>
        </div>
        <p class="text-[11px] font-medium text-indigo-600 mt-0.5 truncate">${cat.department}</p>
        ${descriptionHtml}
        ${addressHtml}
        <div class="text-[10px] text-gray-400 mt-1.5 flex items-center space-x-3">
          ${hasEmail ? `<span><i class="fa-regular fa-envelope mr-1" aria-hidden="true"></i>${cat.destinations.email}</span>` : ""}
          ${hasPhone ? `<span><i class="fa-solid fa-phone mr-1" aria-hidden="true"></i>${cat.destinations.phone}</span>` : ""}
        </div>
      </div>
    `;

    card.addEventListener("click", () => selectCategory(cat.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectCategory(cat.id);
      }
    });

    container.appendChild(card);
  });
}

function selectCategory(categoryId) {
  const category = appConfig && appConfig.categories ? appConfig.categories.find((item) => item.id === categoryId) : null;
  if (!category || !categoryMatchesJurisdiction(category, selectedCoords.lat, selectedCoords.lng)) {
    resetCategorySelection();
    return;
  }

  selectedCategoryId = categoryId;
  trackAnalyticsEvent("category_selected", { category_id: category.id });

  // Hide search bar while a specific category is selected
  const searchWrapper = document.getElementById("category-search-wrapper");
  const noCategoriesMsg = document.getElementById("no-categories-msg");
  if (searchWrapper) searchWrapper.classList.add("hidden");
  if (noCategoriesMsg) noCategoriesMsg.classList.add("hidden");

  // Show only the selected category card
  document.querySelectorAll(".category-card").forEach((card) => {
    const check = card.querySelector(".select-check");
    if (card.dataset.id === categoryId) {
      card.classList.add("active");
      card.classList.remove("hidden");
      card.setAttribute("aria-selected", "true");
      if (check) check.classList.remove("hidden");
    } else {
      card.classList.remove("active");
      card.classList.add("hidden");
      card.setAttribute("aria-selected", "false");
      if (check) check.classList.add("hidden");
    }
  });

  const changeBtn = document.getElementById("change-category-btn");
  const subtitle = document.getElementById("step2-subtitle");
  if (changeBtn) changeBtn.classList.remove("hidden");
  if (subtitle) subtitle.textContent = "Active category selected below.";

  renderQuestionnaire(categoryId);
  syncStateToURL();

  // On smaller screens, scroll directly to the newly revealed questions
  if (window.innerWidth < 1024) {
    const questionsSec = document.getElementById("questionnaire-section");
    if (questionsSec) {
      questionsSec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function resetCategorySelection() {
  selectedCategoryId = null;

  const searchWrapper = document.getElementById("category-search-wrapper");
  const searchInput = document.getElementById("category-search");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  if (searchWrapper) searchWrapper.classList.remove("hidden");
  if (searchInput) searchInput.value = "";
  if (clearSearchBtn) clearSearchBtn.classList.add("hidden");

  document.querySelectorAll(".category-card").forEach((card) => {
    card.classList.remove("active", "hidden");
    card.setAttribute("aria-selected", "false");
    const check = card.querySelector(".select-check");
    if (check) check.classList.add("hidden");
  });

  const changeBtn = document.getElementById("change-category-btn");
  const questionsSec = document.getElementById("questionnaire-section");
  const dispatchBox = document.getElementById("dispatch-box");
  const emergencyBox = document.getElementById("acute-emergency-box");
  const validationErrorBox = document.getElementById("validation-error-box");
  const subtitle = document.getElementById("step2-subtitle");

  if (changeBtn) changeBtn.classList.add("hidden");
  if (questionsSec) questionsSec.classList.add("hidden");
  if (dispatchBox) dispatchBox.classList.add("hidden");
  if (emergencyBox) emergencyBox.classList.add("hidden");
  if (validationErrorBox) validationErrorBox.classList.add("hidden");
  if (subtitle) subtitle.textContent = "Choose a category to display department questions.";

  syncStateToURL();
}

// =============================================================================
// Questionnaire Rendering & Validation
// =============================================================================

function renderQuestionnaire(categoryId) {
  const section = document.getElementById("questionnaire-section");
  const form = document.getElementById("dynamic-form");
  const dispatchBox = document.getElementById("dispatch-box");
  const deptTag = document.getElementById("active-dept-tag");

  if (!form || !appConfig) return;
  form.innerHTML = "";

  const category = appConfig.categories.find((c) => c.id === categoryId);
  if (!category) return;

  if (deptTag) deptTag.textContent = category.department;

  category.questions.forEach((q) => {
    const wrapper = document.createElement("div");
    const inputId = `q-${category.id}-${q.id}`;

    const label = document.createElement("label");
    label.htmlFor = inputId;
    label.className = "block text-xs font-medium text-gray-700 mb-1";
    label.innerHTML = `${q.label} ${q.required ? '<span class="text-red-500 font-bold" title="Required field">*</span>' : ''}`;

    let input;
    if (q.type === "select") {
      input = document.createElement("select");
      input.className = "w-full border border-gray-300 rounded-md p-2 text-xs focus:ring-1 focus:ring-indigo-500 bg-white transition";
      
      if (!q.required) {
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "-- Select an option (optional) --";
        input.appendChild(emptyOpt);
      }

      (q.options || []).forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      });
    } else if (q.type === "textarea") {
      input = document.createElement("textarea");
      input.className = "w-full border border-gray-300 rounded-md p-2 text-xs focus:ring-1 focus:ring-indigo-500 h-20 transition";
      if (q.placeholder) input.placeholder = q.placeholder;
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.className = "w-full border border-gray-300 rounded-md p-2 text-xs focus:ring-1 focus:ring-indigo-500 transition";
      if (q.placeholder) input.placeholder = q.placeholder;
    }

    input.id = inputId;
    input.name = q.id;
    input.dataset.questionId = q.id;
    input.dataset.field = q.id;
    input.dataset.questionLabel = q.label;
    if (q.required) {
      input.required = true;
      input.dataset.required = "true";
    }

    const clearValidationState = () => {
      input.classList.remove("border-red-500", "ring-1", "ring-red-500", "bg-red-50/40");
      const errBox = document.getElementById("validation-error-box");
      if (errBox) errBox.classList.add("hidden");
      updateDispatchOutput();
      syncStateToURL();
    };

    input.addEventListener("input", clearValidationState);
    input.addEventListener("change", clearValidationState);

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });

  if (section) section.classList.remove("hidden");
  if (dispatchBox) dispatchBox.classList.remove("hidden");
  updateDispatchOutput();
}

function validateRequiredFields() {
  const form = document.getElementById("dynamic-form");
  if (!form) return true;

  const requiredInputs = form.querySelectorAll("[data-required='true']");
  let firstInvalid = null;
  let hasError = false;

  requiredInputs.forEach((input) => {
    const val = input.value ? input.value.trim() : "";
    if (!val) {
      hasError = true;
      input.classList.add("border-red-500", "ring-1", "ring-red-500", "bg-red-50/40");
      if (!firstInvalid) firstInvalid = input;
    } else {
      input.classList.remove("border-red-500", "ring-1", "ring-red-500", "bg-red-50/40");
    }
  });

  const errorBox = document.getElementById("validation-error-box");
  if (hasError) {
    if (errorBox) errorBox.classList.remove("hidden");
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    announceToScreenReader("Please fill in all required questionnaire fields before continuing.");
    return false;
  }

  if (errorBox) errorBox.classList.add("hidden");
  return true;
}

// =============================================================================
// Acute Emergency Detection
// =============================================================================

function isAcuteEmergency(category) {
  const emergencyConfig = category && category.emergency ? category.emergency : null;

  // enabled: true acts as an immediate category-wide override
  if (emergencyConfig && emergencyConfig.enabled === true) {
    return true;
  }

  // Otherwise check if specific keywords match selected answers
  const keywords = Array.isArray(emergencyConfig && emergencyConfig.keywords) && emergencyConfig.keywords.length > 0
    ? emergencyConfig.keywords
    : defaultEmergencyKeywords;

  const inputs = document.querySelectorAll("#dynamic-form [data-question-id]");
  for (const input of inputs) {
    const val = (input.value || "").toLowerCase();
    for (const keyword of keywords) {
      if (val.includes(String(keyword).toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

// =============================================================================
// Report Formatting & Email Template Generation
// =============================================================================

function getEmailTemplateData(category) {
  const answers = {};
  const answerLines = [];
  const inputs = document.querySelectorAll("#dynamic-form [data-question-id]");
  inputs.forEach((input) => {
    const label = input.dataset.questionLabel;
    const val = input.value ? input.value.trim() : "N/A";
    answers[input.dataset.questionId] = val;
    answerLines.push(`${label}:\n${val}`);
  });

  return {
    answers,
    variables: {
      appTitle: siteConfig?.appTitle || "Community 311",
      category: category.name,
      department: category.department,
      location: selectedAddress,
      latitude: selectedCoords.lat,
      longitude: selectedCoords.lng,
      mapsUrl: `https://maps.google.com/?q=${selectedCoords.lat},${selectedCoords.lng}`,
      answers: answerLines.join("\n\n")
    }
  };
}

function renderEmailTemplate(template, category) {
  const { answers, variables } = getEmailTemplateData(category);
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)(?::([^}]+))?\}/g, (match, name, questionId) => {
    if (name === "question" && questionId) return answers[questionId] || "N/A";
    return Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : match;
  });
}

function buildEmailBody() {
  if (!selectedCategoryId || !appConfig) return "";
  const category = appConfig.categories.find((c) => c.id === selectedCategoryId);
  if (!category) return "";

  const template = category.emailTemplate || appConfig.emailTemplate || defaultEmailTemplate;
  return renderEmailTemplate(template, category);
}

function buildEmailSubject() {
  if (!selectedCategoryId || !appConfig) return "";
  const category = appConfig.categories.find((c) => c.id === selectedCategoryId);
  if (!category) return "";

  const template = category.emailSubjectTemplate || appConfig.emailSubjectTemplate || defaultEmailSubjectTemplate;
  return renderEmailTemplate(template, category);
}

function renderContactInfo(category) {
  const container = document.getElementById("report-contact-info");
  if (!container) return;
  container.innerHTML = "";
  const destinations = category.destinations || {};
  const items = [
    ["Email", destinations.email],
    ["Phone", destinations.phone],
    ["Official web portal", destinations.webformUrl],
    ["Department page", destinations.socialUrl],
    ["Address", destinations.address]
  ].filter(([, value]) => value);

  if (items.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "text-gray-500";
    emptyMessage.textContent = "No contact information is configured for this category.";
    container.appendChild(emptyMessage);
    return;
  }

  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "min-w-0";
    const name = document.createElement("div");
    name.className = "text-xs font-semibold text-gray-500";
    name.textContent = label;
    const detail = document.createElement("div");
    detail.className = "break-all text-gray-900";
    detail.textContent = value;
    item.append(name, detail);
    container.appendChild(item);
  });
}

function orderDispatchActions(category) {
  const container = document.getElementById("dispatch-actions");
  if (!container) return;

  const buttonsByDestination = {
    email: document.getElementById("mailto-btn"),
    webformUrl: document.getElementById("webform-btn"),
    phone: document.getElementById("phone-btn"),
    address: document.getElementById("visit-office-btn"),
    socialUrl: document.getElementById("social-btn")
  };
  const orderedButtons = Object.keys(category.destinations || {})
    .map((key) => buttonsByDestination[key])
    .filter(Boolean);

  Object.values(buttonsByDestination).forEach((button) => {
    if (button && !orderedButtons.includes(button)) orderedButtons.push(button);
  });
  
  const copyBtn = document.getElementById("copy-btn");
  if (copyBtn) orderedButtons.push(copyBtn);
  container.append(...orderedButtons);
}

function renderReportAnswers() {
  const container = document.getElementById("modal-answers");
  if (!container) return;
  container.innerHTML = "";

  document.querySelectorAll("#dynamic-form [data-question-id]").forEach((input) => {
    const item = document.createElement("div");
    item.className = "min-w-0";
    const label = document.createElement("div");
    label.className = "text-xs font-semibold text-gray-500";
    label.textContent = input.dataset.questionLabel;
    const answer = document.createElement("div");
    answer.className = "mt-1 whitespace-pre-wrap break-words text-gray-900";
    answer.textContent = input.value ? input.value.trim() : "N/A";
    item.append(label, answer);
    container.appendChild(item);
  });
}

// Update review modal and dispatch options based on category configuration & emergency status
function updateDispatchOutput() {
  if (!selectedCategoryId || !appConfig) return;

  const category = appConfig.categories.find((c) => c.id === selectedCategoryId);
  if (!category) return;

  const emergency = isAcuteEmergency(category);
  const emergencyBox = document.getElementById("acute-emergency-box");
  const deptEmergencyCall = document.getElementById("dept-emergency-call");
  const deptEmergencyName = document.getElementById("dept-emergency-name");
  const mailtoBtn = document.getElementById("mailto-btn");
  const copyBtn = document.getElementById("copy-btn");
  const noEmailNotice = document.getElementById("no-email-notice");
  const noEmailText = document.getElementById("no-email-text");

  const modalCat = document.getElementById("modal-category");
  const modalDept = document.getElementById("modal-department");
  const modalLoc = document.getElementById("modal-location");
  const reportPrev = document.getElementById("report-preview");

  if (modalCat) modalCat.textContent = category.name;
  if (modalDept) modalDept.textContent = category.department;
  if (modalLoc) modalLoc.textContent = selectedAddress;
  if (reportPrev) reportPrev.textContent = buildEmailBody();

  renderReportAnswers();
  renderContactInfo(category);
  orderDispatchActions(category);

  // Address map directions button
  const address = category.destinations && category.destinations.address;
  const visitOfficeBtn = document.getElementById("visit-office-btn");
  if (visitOfficeBtn) {
    if (typeof address === "string" && /\d/.test(address)) {
      visitOfficeBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
      visitOfficeBtn.classList.remove("hidden");
    } else {
      visitOfficeBtn.href = "#";
      visitOfficeBtn.classList.add("hidden");
    }
  }

  // Handle Acute Emergency Mode
  if (emergency) {
    if (emergencyBox) emergencyBox.classList.remove("hidden");
    if (category.destinations && category.destinations.phone) {
      if (deptEmergencyCall) {
        deptEmergencyCall.href = `tel:${category.destinations.phone.replace(/[^0-9]/g, "")}`;
        deptEmergencyCall.classList.remove("hidden");
      }
      if (deptEmergencyName) {
        deptEmergencyName.textContent = `Call 24/7 Dispatch: ${category.destinations.phone}`;
      }
    } else {
      if (deptEmergencyCall) deptEmergencyCall.classList.add("hidden");
    }

    // In acute emergencies: Email and copy report are disabled to force immediate phone dispatch
    if (mailtoBtn) mailtoBtn.classList.add("hidden");
    if (copyBtn) copyBtn.classList.add("hidden");
    if (noEmailText) noEmailText.textContent = "Email is disabled for acute emergencies. Call 911 or department dispatch immediately.";
    if (noEmailNotice) noEmailNotice.classList.remove("hidden");
  } else {
    if (emergencyBox) emergencyBox.classList.add("hidden");

    // Normal dispatch mode
    if (category.destinations && category.destinations.email) {
      const emailBody = buildEmailBody();
      const subject = encodeURIComponent(buildEmailSubject());
      const body = encodeURIComponent(emailBody);
      if (mailtoBtn) {
        mailtoBtn.href = `mailto:${category.destinations.email}?subject=${subject}&body=${body}`;
        mailtoBtn.classList.remove("hidden");
      }
      if (copyBtn) copyBtn.classList.remove("hidden");
      if (noEmailNotice) noEmailNotice.classList.add("hidden");
    } else {
      if (mailtoBtn) mailtoBtn.classList.add("hidden");
      if (copyBtn) copyBtn.classList.add("hidden");
      if (noEmailText) noEmailText.textContent = "This department receives reports via official web portal or phone.";
      if (noEmailNotice) noEmailNotice.classList.remove("hidden");
    }
  }

  // Phone action
  const phoneBtn = document.getElementById("phone-btn");
  if (phoneBtn) {
    if (category.destinations && category.destinations.phone) {
      phoneBtn.href = `tel:${category.destinations.phone.replace(/[^0-9]/g, "")}`;
      const phoneText = document.getElementById("phone-btn-text");
      if (phoneText) phoneText.textContent = `Call department: ${category.destinations.phone}`;
      phoneBtn.classList.remove("hidden");
    } else {
      phoneBtn.classList.add("hidden");
    }
  }

  // Webform portal action
  const webformBtn = document.getElementById("webform-btn");
  if (webformBtn) {
    if (category.destinations && category.destinations.webformUrl) {
      webformBtn.href = category.destinations.webformUrl;
      webformBtn.classList.remove("hidden");
    } else {
      webformBtn.classList.add("hidden");
    }
  }

  // Social page action
  const socialBtn = document.getElementById("social-btn");
  if (socialBtn) {
    if (category.destinations && category.destinations.socialUrl) {
      socialBtn.href = category.destinations.socialUrl;
      socialBtn.classList.remove("hidden");
    } else {
      socialBtn.classList.add("hidden");
    }
  }
}

// =============================================================================
// Event Listeners & UI Handlers
// =============================================================================

function setupEventListeners() {
  // Device Geolocation
  const locateBtn = document.getElementById("locate-me-btn");
  const locateIcon = document.getElementById("locate-icon");
  const locateText = document.getElementById("locate-text");

  if (locateBtn) {
    locateBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser. Please tap your location directly on the map.");
        return;
      }

      locateBtn.disabled = true;
      if (locateIcon) locateIcon.className = "fa-solid fa-spinner fa-spin text-indigo-600";
      if (locateText) locateText.textContent = "Locating...";

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          locateBtn.disabled = false;
          if (locateIcon) locateIcon.className = "fa-solid fa-location-arrow text-indigo-600";
          if (locateText) locateText.textContent = "My Location";
          map.setView([pos.coords.latitude, pos.coords.longitude], 16);
          setMarker(pos.coords.latitude, pos.coords.longitude, "device_location");
        },
        (err) => {
          locateBtn.disabled = false;
          if (locateIcon) locateIcon.className = "fa-solid fa-location-arrow text-indigo-600";
          if (locateText) locateText.textContent = "My Location";
          let msg = "Could not obtain device location.";
          if (err.code === 1) msg = "Location permission denied. Please click on the map to place your pin.";
          else if (err.code === 2) msg = "Location position unavailable. Please click on the map.";
          else if (err.code === 3) msg = "Location request timed out. Please click on the map.";
          alert(msg);
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    });
  }

  // Manual Address Refinement Toggle
  const editBtn = document.getElementById("edit-address-btn");
  const editBox = document.getElementById("address-edit-box");
  const manualInput = document.getElementById("manual-address-input");
  const saveBtn = document.getElementById("save-address-btn");
  const cancelBtn = document.getElementById("cancel-address-btn");

  if (editBtn && editBox && manualInput && saveBtn && cancelBtn) {
    editBtn.addEventListener("click", () => {
      manualInput.value = selectedAddress;
      editBox.classList.remove("hidden");
      manualInput.focus();
    });

    saveBtn.addEventListener("click", () => {
      const val = manualInput.value.trim();
      if (val) {
        selectedAddress = val;
        const display = document.getElementById("address-display");
        if (display) {
          display.textContent = selectedAddress;
          display.title = selectedAddress;
        }
        announceToScreenReader(`Address updated to ${selectedAddress}`);
        updateDispatchOutput();
      }
      editBox.classList.add("hidden");
    });

    cancelBtn.addEventListener("click", () => {
      editBox.classList.add("hidden");
    });

    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveBtn.click();
      } else if (e.key === "Escape") {
        cancelBtn.click();
      }
    });
  }

  // Category Search
  const searchInput = document.getElementById("category-search");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const noCategoriesMsg = document.getElementById("no-categories-msg");

  if (searchInput && clearSearchBtn) {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      clearSearchBtn.classList.toggle("hidden", query.length === 0);

      let matchCount = 0;
      document.querySelectorAll(".category-card").forEach((card) => {
        if (selectedCategoryId) return;
        const text = card.textContent.toLowerCase();
        const matches = text.includes(query);
        card.classList.toggle("hidden", !matches);
        if (matches) matchCount++;
      });

      if (noCategoriesMsg) {
        noCategoriesMsg.classList.toggle("hidden", matchCount > 0 || !query);
      }
    });

    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      clearSearchBtn.classList.add("hidden");
      searchInput.dispatchEvent(new Event("input"));
      searchInput.focus();
    });
  }

  // Change Category Button
  const changeCatBtn = document.getElementById("change-category-btn");
  if (changeCatBtn) {
    changeCatBtn.addEventListener("click", resetCategorySelection);
  }

  // Review & Submit Dialog
  const reportModal = document.getElementById("report-modal");
  const saveReportBtn = document.getElementById("save-report-btn");
  const closeReportModalBtn = document.getElementById("close-report-modal");

  if (saveReportBtn && reportModal) {
    saveReportBtn.addEventListener("click", () => {
      if (!validateRequiredFields()) {
        trackAnalyticsEvent("report_review_blocked", { category_id: selectedCategoryId });
        return;
      }
      reportDraftId = window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      updateDispatchOutput();
      reportModal.showModal();
      trackAnalyticsEvent("report_reviewed", { category_id: selectedCategoryId });
    });
  }

  if (closeReportModalBtn && reportModal) {
    closeReportModalBtn.addEventListener("click", () => {
      reportModal.close();
      if (saveReportBtn) saveReportBtn.focus();
    });
  }

  if (reportModal) {
    reportModal.addEventListener("click", (event) => {
      if (event.target === reportModal) {
        reportModal.close();
        if (saveReportBtn) saveReportBtn.focus();
      }
    });
  }

  // Action Tracking Integration Events
  const mailtoBtn = document.getElementById("mailto-btn");
  const webformBtn = document.getElementById("webform-btn");
  const phoneBtn = document.getElementById("phone-btn");
  const officeBtn = document.getElementById("visit-office-btn");
  const socialBtn = document.getElementById("social-btn");
  const emergency911Btn = document.getElementById("emergency-911-call");
  const deptEmergencyCall = document.getElementById("dept-emergency-call");

  if (mailtoBtn) mailtoBtn.addEventListener("click", () => recordReportAction("send_email", "mailto"));
  if (webformBtn) webformBtn.addEventListener("click", () => recordReportAction("open_webform", "webform"));
  if (phoneBtn) phoneBtn.addEventListener("click", () => recordReportAction("call_department", "tel"));
  if (deptEmergencyCall) deptEmergencyCall.addEventListener("click", () => recordReportAction("call_department", "department_dispatch"));
  if (officeBtn) officeBtn.addEventListener("click", () => trackReportMade("office_directions"));
  if (socialBtn) socialBtn.addEventListener("click", () => trackReportMade("social_page"));
  if (emergency911Btn) emergency911Btn.addEventListener("click", () => trackReportMade("emergency_911"));

  // Copy Report Action
  const copyBtn = document.getElementById("copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      trackReportMade("copy_report");
      const text = buildEmailBody();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showCopiedFeedback();
        }).catch(() => {
          fallbackCopyText(text);
        });
      } else {
        fallbackCopyText(text);
      }
    });
  }
}

function trackReportMade(actionType) {
  if (!selectedCategoryId) return;
  trackAnalyticsEvent("report_made", { category_id: selectedCategoryId, action_type: actionType });
}

function recordReportAction(action, actionType = action) {
  if (!selectedCategoryId) return;
  trackReportMade(actionType);
  window.dispatchEvent(new CustomEvent("report-action", {
    detail: { action, categoryId: selectedCategoryId, reportDraftId }
  }));
}

function showCopiedFeedback() {
  const btnText = document.getElementById("copy-text");
  if (btnText) {
    btnText.textContent = "Copied!";
    setTimeout(() => (btnText.textContent = "Copy report"), 2000);
  }
  announceToScreenReader("Report copied to clipboard.");
}

function fallbackCopyText(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
    showCopiedFeedback();
  } catch (e) {
    alert("Unable to copy to clipboard. Please copy text manually.");
  }
  document.body.removeChild(ta);
}

// Auto-hide floating mobile button when form section is already in viewport
function setupMobileObserver() {
  const mobileBtn = document.getElementById("mobile-next-btn");
  const reportSection = document.getElementById("report-form-section");

  if (mobileBtn && reportSection && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          mobileBtn.classList.add("opacity-0", "pointer-events-none");
        } else {
          mobileBtn.classList.remove("opacity-0", "pointer-events-none");
        }
      });
    }, { threshold: 0.15 });
    observer.observe(reportSection);
  }
}

// Toggle OpenStreetMap Info Tooltip on Mobile Tap
function toggleOsmTooltip(e) {
  if (e) e.stopPropagation();
  const tooltip = document.getElementById("osm-tooltip");
  if (tooltip) tooltip.classList.toggle("hidden");
}

// Close tooltip when clicking outside
document.addEventListener("click", (e) => {
  const tooltip = document.getElementById("osm-tooltip");
  const btn = document.getElementById("osm-info-btn");
  if (tooltip && !tooltip.classList.contains("hidden") && btn && !btn.contains(e.target) && !tooltip.contains(e.target)) {
    tooltip.classList.add("hidden");
  }
});
