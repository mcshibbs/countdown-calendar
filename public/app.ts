type Category = {
  id: number;
  name: string;
  color: string;
  builtin: boolean;
};

type CalendarEvent = {
  id: number;
  title: string;
  eventDate: string;
  occurrenceDate: string;
  daysUntil: number;
  categoryId: number;
  categoryName: string;
  categoryColor: string;
  categoryBuiltin: boolean;
  recurrence: "none" | "annual";
  source: "manual" | "federal" | "christian";
  notes: string;
};

type EventPayload = {
  title: string;
  eventDate: string;
  recurrence: "none" | "annual";
  categoryName: string;
  categoryColor: string;
  notes: string;
};

type ImportResponse = {
  imported: number;
  skipped: number;
  errors: string[];
};

type ViewName = "home" | "settings";

const CATEGORY_FILTER_STORAGE_KEY = "countdown-calendar-hidden-categories";

const state: {
  categories: Category[];
  events: CalendarEvent[];
  editingId: number | null;
  activeView: ViewName;
  hiddenCategoryIds: Set<number>;
} = {
  categories: [],
  events: [],
  editingId: null,
  activeView: "home",
  hiddenCategoryIds: loadHiddenCategoryIds()
};

const navButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view-target]"));
const openEventButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-open-event-modal]"));
const views = Array.from(document.querySelectorAll<HTMLElement>(".view"));
const navMenu = document.querySelector("#nav-menu") as HTMLDetailsElement;
const eventDialog = document.querySelector("#event-dialog") as HTMLDialogElement;
const closeEventModalButton = document.querySelector("#close-event-modal") as HTMLButtonElement;

const form = document.querySelector("#event-form") as HTMLFormElement;
const formTitle = document.querySelector("#form-title") as HTMLHeadingElement;
const submitButton = document.querySelector("#submit-button") as HTMLButtonElement;
const cancelEditButton = document.querySelector("#cancel-edit") as HTMLButtonElement;
const formMessage = document.querySelector("#form-message") as HTMLParagraphElement;
const titleInput = document.querySelector("#title") as HTMLInputElement;
const dateInput = document.querySelector("#event-date") as HTMLInputElement;
const categoryInput = document.querySelector("#category-name") as HTMLInputElement;
const categoryColor = document.querySelector("#category-color") as HTMLInputElement;
const colorState = document.querySelector("#color-state") as HTMLDivElement;
const notesInput = document.querySelector("#notes") as HTMLTextAreaElement;
const categoryOptions = document.querySelector("#category-options") as HTMLDataListElement;
const eventList = document.querySelector("#event-list") as HTMLDivElement;
const categoryLegend = document.querySelector("#category-legend") as HTMLDivElement;
const filterSummaryCount = document.querySelector("#filter-summary-count") as HTMLSpanElement;
const showAllCategoriesButton = document.querySelector("#show-all-categories") as HTMLButtonElement;
const hideAllCategoriesButton = document.querySelector("#hide-all-categories") as HTMLButtonElement;
const rangeDays = document.querySelector("#range-days") as HTMLSelectElement;

const importForm = document.querySelector("#import-form") as HTMLFormElement;
const importFile = document.querySelector("#import-file") as HTMLInputElement;
const importFormat = document.querySelector("#import-format") as HTMLSelectElement;
const importCategoryInput = document.querySelector("#import-category-name") as HTMLInputElement;
const importCategoryColor = document.querySelector("#import-category-color") as HTMLInputElement;
const importColorState = document.querySelector("#import-color-state") as HTMLDivElement;
const importMessage = document.querySelector("#import-message") as HTMLParagraphElement;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric"
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showView((button.dataset.viewTarget ?? "home") as ViewName);
    closeMenu();
  });
});

openEventButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showView("home");
    openEventModal();
    closeMenu();
  });
});

form.addEventListener("submit", handleSubmit);
cancelEditButton.addEventListener("click", closeEventModal);
closeEventModalButton.addEventListener("click", closeEventModal);
eventDialog.addEventListener("click", (event) => {
  if (event.target === eventDialog) {
    closeEventModal();
  }
});
categoryInput.addEventListener("input", syncCategoryColor);
rangeDays.addEventListener("change", refreshEvents);
showAllCategoriesButton.addEventListener("click", showAllCategories);
hideAllCategoriesButton.addEventListener("click", hideAllCategories);

importForm.addEventListener("submit", handleImport);
importCategoryInput.addEventListener("input", syncImportCategoryColor);

void initialize();

async function initialize(): Promise<void> {
  setTodayAsDefault();
  await refreshCategories();
  await refreshEvents();
  const initialHash = window.location.hash.replace("#", "");
  const initialView = viewFromHash();
  showView(initialView);

  if (initialHash === "add") {
    openEventModal();
  }
}

async function refreshCategories(): Promise<void> {
  const data = await apiGet<{ categories: Category[] }>("/api/categories");
  state.categories = data.categories;
  pruneHiddenCategoryIds();
  renderCategories();
  syncCategoryColor();
  syncImportCategoryColor();
}

async function refreshEvents(): Promise<void> {
  const data = await apiGet<{ events: CalendarEvent[] }>(`/api/events?days=${rangeDays.value}`);
  state.events = data.events;
  renderEvents();
}

function showView(viewName: ViewName): void {
  state.activeView = viewName;

  views.forEach((view) => {
    view.classList.toggle("is-active", view.id === `${viewName}-view`);
  });

  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
  });

  if (window.location.hash !== `#${viewName}`) {
    window.history.replaceState(null, "", `#${viewName}`);
  }
}

function viewFromHash(): ViewName {
  const hash = window.location.hash.replace("#", "");
  if (hash === "settings") {
    return hash;
  }
  return "home";
}

function openEventModal(): void {
  if (!eventDialog.open) {
    eventDialog.showModal();
  }

  titleInput.focus();
}

function closeEventModal(): void {
  if (eventDialog.open) {
    eventDialog.close();
  }

  resetForm();
}

function closeMenu(): void {
  navMenu.open = false;
}

function renderCategories(): void {
  categoryOptions.innerHTML = state.categories
    .map((category) => `<option value="${escapeHtml(category.name)}"></option>`)
    .join("");

  updateFilterSummary();

  categoryLegend.innerHTML = state.categories
    .map((category) => {
      const isVisible = !state.hiddenCategoryIds.has(category.id);

      return `
        <button
          class="category-pill filter-pill ${isVisible ? "is-active" : "is-muted"}"
          type="button"
          data-category-id="${category.id}"
          aria-pressed="${isVisible}"
        >
          <span class="swatch" style="background:${category.color}"></span>
          ${escapeHtml(category.name)}
          <span class="filter-state">${isVisible ? "On" : "Off"}</span>
        </button>
      `;
    })
    .join("");

  categoryLegend.querySelectorAll("[data-category-id]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleCategory(Number((button as HTMLButtonElement).dataset.categoryId));
    });
  });
}

function renderEvents(): void {
  const visibleEvents = state.events.filter((event) => !state.hiddenCategoryIds.has(event.categoryId));

  if (!state.events.length) {
    eventList.innerHTML = `<div class="empty-state">No events in this range.</div>`;
    return;
  }

  if (!visibleEvents.length) {
    eventList.innerHTML = `<div class="empty-state">No events match the selected calendars.</div>`;
    return;
  }

  eventList.innerHTML = visibleEvents.map(renderEventCard).join("");

  eventList.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number((button as HTMLButtonElement).dataset.editId);
      const event = state.events.find((item) => item.id === id);
      if (event) {
        startEditing(event);
      }
    });
  });

  eventList.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number((button as HTMLButtonElement).dataset.deleteId);
      const event = state.events.find((item) => item.id === id);
      if (!event || !confirm(`Delete "${event.title}"?`)) {
        return;
      }
      await deleteEvent(id);
    });
  });
}

function toggleCategory(categoryId: number): void {
  if (state.hiddenCategoryIds.has(categoryId)) {
    state.hiddenCategoryIds.delete(categoryId);
  } else {
    state.hiddenCategoryIds.add(categoryId);
  }

  saveHiddenCategoryIds();
  renderCategories();
  renderEvents();
}

function showAllCategories(): void {
  state.hiddenCategoryIds.clear();
  saveHiddenCategoryIds();
  renderCategories();
  renderEvents();
}

function hideAllCategories(): void {
  state.hiddenCategoryIds = new Set(state.categories.map((category) => category.id));
  saveHiddenCategoryIds();
  renderCategories();
  renderEvents();
}

function updateFilterSummary(): void {
  const visibleCount = state.categories.filter((category) => !state.hiddenCategoryIds.has(category.id)).length;

  if (!state.categories.length) {
    filterSummaryCount.textContent = "None";
  } else if (visibleCount === state.categories.length) {
    filterSummaryCount.textContent = "All shown";
  } else {
    filterSummaryCount.textContent = `${visibleCount} of ${state.categories.length} shown`;
  }
}

function pruneHiddenCategoryIds(): void {
  const validIds = new Set(state.categories.map((category) => category.id));
  state.hiddenCategoryIds = new Set(
    Array.from(state.hiddenCategoryIds).filter((categoryId) => validIds.has(categoryId))
  );
  saveHiddenCategoryIds();
}

function loadHiddenCategoryIds(): Set<number> {
  try {
    const storedValue = window.localStorage.getItem(CATEGORY_FILTER_STORAGE_KEY);
    if (!storedValue) {
      return new Set();
    }

    const parsed = JSON.parse(storedValue) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(
      parsed
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    );
  } catch {
    return new Set();
  }
}

function saveHiddenCategoryIds(): void {
  try {
    window.localStorage.setItem(
      CATEGORY_FILTER_STORAGE_KEY,
      JSON.stringify(Array.from(state.hiddenCategoryIds))
    );
  } catch {
    // Filtering still works for the current session if local storage is unavailable.
  }
}

function renderEventCard(event: CalendarEvent): string {
  const canManage = event.source === "manual";
  const recurrenceLabel = event.recurrence === "annual" ? "Yearly" : "Once";
  const sourceLabel = event.source === "manual" ? recurrenceLabel : labelForSource(event.source);

  return `
    <article class="event-card" style="--event-color:${event.categoryColor}">
      <div class="event-main">
        <h3 class="event-title">${escapeHtml(event.title)}</h3>
        <div class="event-meta">
          <span class="category-pill">
            <span class="swatch" style="background:${event.categoryColor}"></span>
            ${escapeHtml(event.categoryName)}
          </span>
          <span>${formatDateForDisplay(event.occurrenceDate)}</span>
          <span>${sourceLabel}</span>
        </div>
      </div>
      <div class="countdown" aria-label="${event.daysUntil} days until ${escapeHtml(event.title)}">
        <span class="countdown-value">${formatCountdown(event.occurrenceDate)}</span>
        <span class="countdown-label">${countdownLabel(event.daysUntil)}</span>
      </div>
      ${
        canManage
          ? `
            <div class="event-actions">
              <button class="button button-ghost" type="button" data-edit-id="${event.id}">Edit</button>
              <button class="button button-danger" type="button" data-delete-id="${event.id}">Delete</button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

async function handleSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setMessage("");

  const payload = getPayload();
  const existingCategory = findCategory(payload.categoryName);

  if (!existingCategory && !payload.categoryColor) {
    setMessage("Pick a color for the new category.", true);
    return;
  }

  try {
    if (state.editingId) {
      await apiSend(`/api/events/${state.editingId}`, "PUT", payload);
      setMessage("Event updated.");
    } else {
      await apiSend("/api/events", "POST", payload);
      setMessage("Event added.");
    }

    resetForm(false);
    await refreshCategories();
    await refreshEvents();
    closeEventModal();
    showView("home");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Something went wrong.", true);
  }
}

async function handleImport(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setImportMessage("");

  const file = importFile.files?.[0];
  if (!file) {
    setImportMessage("Choose a file to import.", true);
    return;
  }

  const existingCategory = findCategory(importCategoryInput.value.trim());
  if (!existingCategory && !importCategoryColor.value) {
    setImportMessage("Pick a color for the import category.", true);
    return;
  }

  try {
    const content = await file.text();
    const result = await apiSend<ImportResponse>("/api/import", "POST", {
      format: importFormat.value,
      filename: file.name,
      content,
      categoryName: importCategoryInput.value.trim(),
      categoryColor: importCategoryColor.disabled ? "" : importCategoryColor.value
    });

    await refreshCategories();
    await refreshEvents();
    importForm.reset();
    importCategoryInput.value = "Imported Events";
    syncImportCategoryColor();

    const warning = result.errors.length ? ` ${result.errors.length} row warnings.` : "";
    setImportMessage(`Imported ${result.imported}. Skipped ${result.skipped}.${warning}`);
  } catch (error) {
    setImportMessage(error instanceof Error ? error.message : "Import failed.", true);
  }
}

function getPayload(): EventPayload {
  const recurrenceInput = form.querySelector("input[name='recurrence']:checked") as HTMLInputElement;

  return {
    title: titleInput.value.trim(),
    eventDate: dateInput.value,
    recurrence: recurrenceInput.value === "annual" ? "annual" : "none",
    categoryName: categoryInput.value.trim(),
    categoryColor: categoryColor.disabled ? "" : categoryColor.value,
    notes: notesInput.value.trim()
  };
}

function startEditing(event: CalendarEvent): void {
  state.editingId = event.id;
  titleInput.value = event.title;
  dateInput.value = event.eventDate;
  categoryInput.value = event.categoryName;
  categoryColor.value = event.categoryColor;
  notesInput.value = event.notes ?? "";

  const recurrenceInput = form.querySelector(
    `input[name='recurrence'][value='${event.recurrence}']`
  ) as HTMLInputElement;
  recurrenceInput.checked = true;

  formTitle.textContent = "Edit event";
  submitButton.textContent = "Save changes";
  cancelEditButton.classList.remove("hidden");
  syncCategoryColor();
  showView("home");
  openEventModal();
}

function resetForm(clearMessage = true): void {
  state.editingId = null;
  form.reset();
  setTodayAsDefault();
  formTitle.textContent = "Add event";
  submitButton.textContent = "Add event";
  cancelEditButton.classList.add("hidden");
  syncCategoryColor();

  if (clearMessage) {
    setMessage("");
  }
}

async function deleteEvent(id: number): Promise<void> {
  try {
    await apiSend(`/api/events/${id}`, "DELETE");
    await refreshEvents();
    setMessage("Event deleted.");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Could not delete event.", true);
  }
}

function syncCategoryColor(): void {
  const category = findCategory(categoryInput.value.trim());

  if (category) {
    categoryColor.value = category.color;
    categoryColor.disabled = true;
    colorState.textContent = category.builtin ? "Built-in color" : "Existing category";
  } else {
    categoryColor.disabled = false;
    colorState.textContent = "New category";
  }
}

function syncImportCategoryColor(): void {
  const category = findCategory(importCategoryInput.value.trim());

  if (category) {
    importCategoryColor.value = category.color;
    importCategoryColor.disabled = true;
    importColorState.textContent = category.builtin ? "Built-in color" : "Existing category";
  } else {
    importCategoryColor.disabled = false;
    importColorState.textContent = "New category";
  }
}

function findCategory(name: string): Category | undefined {
  return state.categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
}

function setTodayAsDefault(): void {
  if (!dateInput.value) {
    dateInput.value = toDateOnly(new Date());
  }
}

function formatCountdown(dateString: string): string {
  const days = daysUntil(dateString);

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Tomorrow";
  }

  if (days < 14) {
    return `${days} days`;
  }

  if (days < 60) {
    const weeks = Math.floor(days / 7);
    const remainingDays = days % 7;
    return joinParts([
      plural(weeks, "week"),
      remainingDays ? plural(remainingDays, "day") : ""
    ]);
  }

  const today = startOfToday();
  const target = parseDateOnly(dateString);
  let months = 0;
  let cursor = today;

  while (addMonths(cursor, 1) <= target) {
    cursor = addMonths(cursor, 1);
    months += 1;
  }

  const remainingDays = Math.round((target.getTime() - cursor.getTime()) / 86_400_000);
  return joinParts([
    plural(months, "month"),
    remainingDays ? plural(remainingDays, "day") : ""
  ]);
}

function countdownLabel(days: number): string {
  if (days === 0) {
    return "happening";
  }
  return "until";
}

function daysUntil(dateString: string): number {
  const today = startOfToday().getTime();
  const target = parseDateOnly(dateString).getTime();
  return Math.round((target - today) / 86_400_000);
}

function parseDateOnly(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addMonths(date: Date, count: number): Date {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + count);
  next.setDate(Math.min(originalDay, daysInMonth(next.getFullYear(), next.getMonth())));
  return next;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function joinParts(parts: string[]): string {
  return parts.filter(Boolean).join(", ");
}

function formatDateForDisplay(dateString: string): string {
  return dateFormatter.format(parseDateOnly(dateString));
}

function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function labelForSource(source: CalendarEvent["source"]): string {
  if (source === "federal") {
    return "Federal";
  }
  if (source === "christian") {
    return "Christian";
  }
  return "Manual";
}

async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return handleResponse<T>(response);
}

async function apiSend<T = unknown>(url: string, method: string, payload?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });
  return handleResponse<T>(response);
}

async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : undefined;

  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed with ${response.status}`);
  }

  return data as T;
}

function setMessage(message: string, isError = false): void {
  formMessage.textContent = message;
  formMessage.classList.toggle("error", isError);
}

function setImportMessage(message: string, isError = false): void {
  importMessage.textContent = message;
  importMessage.classList.toggle("error", isError);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
