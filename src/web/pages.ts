type ApiRecord = Record<string, any>;

const statusNames = ["normal", "disrupted", "cancelled"] as const;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: unknown): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function statusName(status: unknown): string {
  return statusNames[Number(status)] ?? "unknown";
}

function statusLabel(status: unknown): string {
  switch (statusName(status)) {
    case "normal":
      return "Normal operations";
    case "disrupted":
      return "Sailings disrupted";
    case "cancelled":
      return "Sailings cancelled";
    default:
      return "Unknown status";
  }
}

function disruptionText(status: unknown): string {
  switch (statusName(status)) {
    case "normal":
      return "There are currently no disruptions with this service.";
    case "disrupted":
      return "There are disruptions with this service.";
    case "cancelled":
      return "Sailings have been cancelled for this service.";
    default:
      return "There was a problem fetching the service status.";
  }
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateInput(value: Date): string {
  return formatDateInput(value);
}

export function isDateInput(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatDateTime(value: unknown): string {
  if (!value) return "Unknown";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London"
  }).format(date);
}

function formatTime(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Europe/London"
  }).format(date);
}

function hasCalmacBrand(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("calmac") || normalized.includes("caledonian macbrayne");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="/favicon.ico">
    <link rel="stylesheet" href="/styles.css">
    <script src="/client.js" defer></script>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

function siteHeading(): string {
  return `<section class="page-intro">
    <h1 class="title"><a class="title-link" href="/">Scottish Ferries</a></h1>
    <p class="page-subtitle">The latest disruption information</p>
  </section>`;
}

function siteFooter(): string {
  return `<footer class="site-footer">
    <h2>Support</h2>
    <p>Please contact me at <a href="mailto:stefan.church@gmail.com">stefan.church@gmail.com</a> if you have any issues or questions.</p>
    <p class="footer-links"><a href="/privacy-policy">Privacy Policy</a></p>
  </footer>`;
}

function appPromo(): string {
  return `<section class="app-promo">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="/assets/screenshot-dark.png">
      <img class="app-promo-shot" src="/assets/screenshot.png" alt="Scottish Ferries app screenshot" loading="lazy">
    </picture>
    <div class="app-promo-content">
      <h2>Get the App</h2>
      <p>Get notified about the latest disruptions with the app.</p>
      <div class="store-links">
        <a href="https://apps.apple.com/nz/app/scottish-ferries/id861271891" target="_blank" rel="noreferrer" aria-label="Download on the App Store">
          <img src="/assets/app-store.png" alt="Download on the App Store">
        </a>
        <a href="https://play.google.com/store/apps/details?id=com.stefanchurch.ferryservices" target="_blank" rel="noreferrer" aria-label="Get it on Google Play">
          <img src="/assets/play-store.png" alt="Get it on Google Play">
        </a>
      </div>
    </div>
  </section>`;
}

function pageChrome(content: string): string {
  return `<main>
    ${siteHeading()}
    <div class="content-with-promo">
      <div class="primary-content">${content}</div>
      <aside class="promo-column">${appPromo()}</aside>
    </div>
    ${siteFooter()}
  </main>`;
}

export function renderServicesPage(services: ApiRecord[]): string {
  const groups = new Map<string, ApiRecord[]>();
  for (const service of services) {
    const key = String(service.operator?.name ?? "Services");
    groups.set(key, [...(groups.get(key) ?? []), service]);
  }

  const sections = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([groupName, groupServices]) => {
      const logo = hasCalmacBrand(groupName) ? `<img class="group-logo" src="/assets/calmac-logo.png" alt="" aria-hidden="true">` : "";
      const rows = groupServices.map((service) => {
        const status = statusName(service.status);
        return `<a class="row-link" href="/service/${encodeURIComponent(String(service.service_id))}" data-service-row data-search="${escapeAttribute(`${service.area} ${service.route}`.toLowerCase())}">
          <article class="row">
            <span class="status-dot status-${status}" aria-hidden="true"></span>
            <div class="row-main">
              <strong>${escapeHtml(service.area)}</strong>
              <div class="route">${escapeHtml(service.route)}</div>
              <div class="status-text status-${status}">${escapeHtml(statusLabel(service.status))}</div>
            </div>
          </article>
        </a>`;
      }).join("");

      return `<section class="group" data-service-group>
        <h2 class="group-heading">${logo}<span>${escapeHtml(groupName)}</span></h2>
        ${rows}
      </section>`;
    }).join("");

  const content = `<div class="header">
    <div class="controls">
      <input class="search" type="search" placeholder="Search by area or route" aria-label="Search services" data-service-search>
    </div>
  </div>
  <p class="muted" data-empty-search hidden>No services found.</p>
  ${sections}`;

  return layout("Scottish Ferries", pageChrome(content));
}

function locationSummary(service: ApiRecord): string {
  const locations = [...(service.locations ?? [])].sort((left, right) => String(left.name).localeCompare(String(right.name)));
  return `<h2 class="title card-subtitle">Locations</h2>
  <div class="grid">
    ${locations.map((location) => {
      const nextFerry = location.next_departure
        ? `<p class="small" style="margin: 6px 0">Next ferry: <strong>${escapeHtml(formatTime(location.next_departure.departure))}</strong> to ${escapeHtml(location.next_departure.destination?.name)}</p>`
        : "";
      const nextRail = location.next_rail_departure
        ? `<p class="small" style="margin: 6px 0">Next rail: <strong>${escapeHtml(formatTime(location.next_rail_departure.departure))}</strong> to ${escapeHtml(location.next_rail_departure.to)}${location.next_rail_departure.platform ? ` &bull; Platform ${escapeHtml(location.next_rail_departure.platform)}` : ""}${location.next_rail_departure.is_cancelled ? ` &bull; <span class="status-cancelled">Cancelled</span>` : location.next_rail_departure.departure_info ? ` &bull; ${escapeHtml(location.next_rail_departure.departure_info)}` : ""}</p>`
        : "";
      const weather = location.weather
        ? `<p class="small muted" style="margin: 6px 0">${escapeHtml(location.weather.temperature_celsius)}C, ${escapeHtml(location.weather.description)}, wind ${escapeHtml(location.weather.wind_speed_mph)} mph ${escapeHtml(location.weather.wind_direction_cardinal)}</p>`
        : "";
      return `<article class="location">
        <h3>${escapeHtml(location.name)}</h3>
        ${nextFerry}${nextRail}${weather}
      </article>`;
    }).join("")}
  </div>`;
}

function scheduledDepartures(service: ApiRecord, departuresDate: string, now: Date): string {
  if (!service.scheduled_departures_available) return "";

  const locations = ((service.locations ?? []) as ApiRecord[])
    .filter((location) => Array.isArray(location.scheduled_departures) && location.scheduled_departures.length > 0)
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  if (locations.length === 0) return "";

  const routes = locations.map((location) => {
    const byDestination = new Map<number, ApiRecord[]>();
    for (const departure of location.scheduled_departures) {
      const destinationId = Number(departure.destination?.id ?? 0);
      byDestination.set(destinationId, [...(byDestination.get(destinationId) ?? []), departure]);
    }

    return [...byDestination.entries()].map(([destinationId, departures]) => {
      const destinationName = departures[0]?.destination?.name ?? "Destination";
      const rows = departures
        .sort((left, right) => String(left.departure).localeCompare(String(right.departure)))
        .map((departure) => {
          const hasDeparted = new Date(String(departure.departure)).getTime() < now.getTime();
          return `<div class="departure-row ${hasDeparted ? "departure-dim" : ""}">
            <span>${escapeHtml(formatTime(departure.departure))}</span>
            <span>${escapeHtml(formatTime(departure.arrival))}</span>
          </div>`;
        }).join("");
      return `<article class="departures-route" data-destination-id="${escapeAttribute(destinationId)}">
        <h3>${escapeHtml(location.name)} to ${escapeHtml(destinationName)}</h3>
        ${rows}
      </article>`;
    }).join("");
  }).join("");

  return `<div class="panel-divider"></div>
  <div class="section-header">
    <h2 class="title card-subtitle">Scheduled Departures</h2>
    <form class="date-picker" method="get" action="/service/${encodeURIComponent(String(service.service_id))}">
      <span class="sr-only">Scheduled departures date</span>
      <input class="date-input" type="date" name="departuresDate" value="${escapeAttribute(departuresDate)}" aria-label="Scheduled departures date" onchange="this.form.submit()">
    </form>
  </div>
  ${routes}`;
}

function operatorActions(operator: ApiRecord | null | undefined): string {
  if (!operator) return "";
  const logo = hasCalmacBrand(String(operator.name)) ? `<img class="operator-logo" src="/assets/calmac-logo.png" alt="" aria-hidden="true">` : "";
  const links = [
    operator.local_number ? `<a class="button" href="tel:${escapeAttribute(String(operator.local_number).split(" ").join("-"))}">Phone</a>` : "",
    operator.website ? `<a class="button" href="${escapeAttribute(operator.website)}" target="_blank" rel="noreferrer">Website</a>` : "",
    operator.email ? `<a class="button" href="mailto:${escapeAttribute(operator.email)}">Email</a>` : "",
    operator.x ? `<a class="button" href="${escapeAttribute(operator.x)}" target="_blank" rel="noreferrer">X</a>` : "",
    operator.facebook ? `<a class="button" href="${escapeAttribute(operator.facebook)}" target="_blank" rel="noreferrer">Facebook</a>` : ""
  ].join("");

  return `<div class="panel-divider"></div>
  <h2 class="title card-subtitle operator-heading">${logo}<span>${escapeHtml(operator.name)}</span></h2>
  <div class="inline-buttons">${links}</div>`;
}

function reliabilitySummary(service: ApiRecord): string {
  const period = service.reliability?.status_breakdown?.last_30_days;
  if (!period || Number(period.observed_operating_days) === 0) return "";
  const disrupted = Number(period.day_statuses?.disrupted?.days ?? 0);
  const cancelled = Number(period.day_statuses?.cancelled?.days ?? 0);
  return `<p class="small muted" style="margin-bottom: 0">
    Last 30 days: ${escapeHtml(disrupted)} disrupted day${disrupted === 1 ? "" : "s"}, ${escapeHtml(cancelled)} cancelled day${cancelled === 1 ? "" : "s"} across ${escapeHtml(period.scheduled_sailings)} scheduled sailing${Number(period.scheduled_sailings) === 1 ? "" : "s"}.
  </p>`;
}

export function renderServicePage(service: ApiRecord, departuresDate: string, now: Date): string {
  const status = statusName(service.status);
  const hasAdditionalInfo = Boolean(String(service.additional_info ?? "").trim());
  const detailsLink = hasAdditionalInfo
    ? `<p style="margin-bottom: 0"><a href="/service/${encodeURIComponent(String(service.service_id))}/info">View disruption details</a></p>`
    : "";
  const content = `<section class="panel service-summary">
    <h1 class="title" style="margin-bottom: 0; font-size: 1.1rem">${escapeHtml(service.area)}</h1>
    <div class="muted" style="margin-bottom: 12px">${escapeHtml(service.route)}</div>
    <div class="status-inline status-text status-${status}">
      <span class="status-dot status-${status}" aria-hidden="true"></span>
      <span>${escapeHtml(statusLabel(service.status))}</span>
    </div>
    <p style="margin-top: 12px; margin-bottom: 0">${escapeHtml(disruptionText(service.status))}</p>
    ${service.disruption_reason ? `<p class="small" style="margin-bottom: 0">${escapeHtml(service.disruption_reason)}</p>` : ""}
    <p class="small muted" style="margin-bottom: 0">Last updated: ${escapeHtml(formatDateTime(service.last_updated_date ?? service.updated))}</p>
    ${reliabilitySummary(service)}
    ${detailsLink}
    ${locationSummary(service)}
    ${scheduledDepartures(service, departuresDate, now)}
    ${operatorActions(service.operator)}
  </section>`;

  return layout(`${service.area} - Scottish Ferries`, pageChrome(content));
}

export function renderAdditionalInfoPage(service: ApiRecord): string {
  const content = `<div class="header">
    <h1 class="title">${escapeHtml(service.area)} Info</h1>
  </div>
  <section class="panel">
    ${String(service.additional_info ?? "")}
  </section>`;
  return layout(`${service.area} Info - Scottish Ferries`, pageChrome(content));
}

export function renderNotFoundPage(message = "Page not found"): string {
  return layout("Not Found - Scottish Ferries", pageChrome(`<section class="panel"><h1 class="title">Not Found</h1><p>${escapeHtml(message)}</p></section>`));
}

export function renderPrivacyPolicyPage(): string {
  const content = `<article class="panel policy">
    <header class="policy-header">
      <p class="policy-kicker">Effective date: April 27, 2026</p>
      <h1>Privacy Policy</h1>
      <p>This Privacy Policy explains how Scottish Ferries handles information in the iOS, Android, and web versions of the app.</p>
    </header>
    <section><h2>Overview</h2><p>Scottish Ferries provides ferry service information and does not require user accounts, names, email addresses, payment details, or location access to use the app.</p><p>We do not sell personal information, use advertising trackers, or use app data for cross-app or cross-site tracking.</p></section>
    <section><h2>Information We Collect</h2><p>We do not collect personal information such as your name, email address, phone number, contacts, photos, payment information, or precise location.</p><p>The app may request ferry service data from our servers so that it can show current routes, schedules, disruption details, and related operational information. These requests are used to provide the app's core functionality.</p></section>
    <section><h2>Crash and Diagnostic Data</h2><p>The native iOS and Android apps use Sentry, a third-party crash reporting and monitoring service, to help us identify and fix errors. If the app encounters a crash or technical issue, Sentry may receive diagnostic information such as:</p><ul><li>Crash logs and stack traces</li><li>Device type and operating system version</li><li>App version</li><li>Error timestamps and general diagnostic information</li></ul><p>This diagnostic information is used only to improve app stability, performance, and reliability. It is not used to identify you personally, track you across apps or websites, or serve advertising.</p></section>
    <section><h2>How We Use Information</h2><p>Information handled by the app is used to:</p><ul><li>Provide ferry service information and app functionality</li><li>Identify and fix bugs</li><li>Improve app stability and performance</li><li>Protect the reliability and security of the service</li></ul></section>
    <section><h2>Data Sharing</h2><p>Crash and diagnostic data may be shared with Sentry for the purposes described in this policy. Sentry processes this data as a service provider. You can read Sentry's privacy policy at <a href="https://sentry.io/privacy/" target="_blank" rel="noreferrer">https://sentry.io/privacy/</a>.</p><p>We do not sell your data or share it with advertisers or data brokers.</p></section>
    <section><h2>Data Storage, Retention, and Deletion</h2><p>We do not store personal user account data because the app does not provide user accounts. Crash and diagnostic data may be retained by Sentry for a limited period so we can investigate and resolve issues.</p><p>If you contact us about a privacy request, we will respond using the contact details you provide and delete any support correspondence when it is no longer needed.</p></section>
    <section><h2>Security</h2><p>Data transmitted by the app is sent using standard HTTPS encryption in transit. We limit third-party sharing to the service providers needed to operate and maintain the app.</p></section>
    <section><h2>Your Choices and Rights</h2><p>Because Scottish Ferries does not require accounts or collect personal profile information, there is generally no account data to access, modify, or delete. You can stop future diagnostic data collection by uninstalling the app.</p><p>If you have a privacy question or request, contact us at <a href="mailto:stefan.church@gmail.com">stefan.church@gmail.com</a>.</p></section>
    <section><h2>Children's Privacy</h2><p>Scottish Ferries is a general audience app and is not directed at children. We do not knowingly collect personal information from children.</p></section>
    <section><h2>Changes to This Policy</h2><p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated effective date.</p></section>
    <section><h2>Contact</h2><p>Developer: Stefan Church<br>Privacy contact: <a href="mailto:stefan.church@gmail.com">stefan.church@gmail.com</a></p></section>
  </article>`;
  return layout("Privacy Policy - Scottish Ferries", pageChrome(content));
}
