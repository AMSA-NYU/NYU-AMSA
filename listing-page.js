function renderListingPage(options) {
  const target = document.getElementById(options.targetId);
  const items = Array.isArray(options.items) ? options.items : [];

  if (!target) {
    return;
  }

  if (items.length === 0) {
    target.innerHTML = `
      <article class="empty-state">
        <h2>${escapeHtml(options.emptyTitle)}</h2>
        <p>${escapeHtml(options.emptyMessage)}</p>
      </article>
    `;
    return;
  }

  target.innerHTML = items
    .map((item) => renderListingCard(item, options.actionLabel, options.showLinks !== false))
    .join("");
}

function partitionListingItemsByDate(items, options = {}) {
  const timeZone = options.timeZone || "America/New_York";
  const now = options.now instanceof Date ? options.now : new Date();
  const today = getDateKeyInTimeZone(now, timeZone);
  const groups = { upcoming: [], past: [] };

  (Array.isArray(items) ? items : []).forEach((item) => {
    const endDate = typeof item.endDate === "string" ? item.endDate : "";
    const destination = /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate < today
      ? groups.past
      : groups.upcoming;

    destination.push(item);
  });

  groups.upcoming.sort(compareEventDates);
  groups.past.sort((first, second) => compareEventDates(second, first));

  return groups;
}

function getDateKeyInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function compareEventDates(first, second) {
  return String(first.endDate || "9999-12-31").localeCompare(
    String(second.endDate || "9999-12-31")
  );
}

function renderListingCard(item, actionLabel, showLink = true) {
  const meta = [item.date, item.time, item.location].filter(Boolean).join(" • ");
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const link = showLink && item.link
    ? `<a class="card-link" href="${escapeAttribute(item.link)}" target="_blank" rel="noopener">${escapeHtml(actionLabel)}</a>`
    : "";

  return `
    <article class="listing-card">
      <div>
        ${item.type ? `<p class="card-kicker">${escapeHtml(item.type)}</p>` : ""}
        <h2>${escapeHtml(item.title || "Untitled")}</h2>
        ${meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : ""}
        ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
      </div>
      ${tags.length ? `<div class="tag-row">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      ${link}
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
