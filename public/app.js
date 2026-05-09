// Generated from app.ts by scripts/build-client.ts.
const CATEGORY_FILTER_STORAGE_KEY = "countdown-calendar-hidden-categories";
const state = {
    categories: [],
    events: [],
    editingId: null,
    activeView: "home",
    hiddenCategoryIds: loadHiddenCategoryIds(),
    settings: {
        eventDetailsEnabled: true,
        darkModeEnabled: false
    },
    displayMode: "list",
    calendarCursor: startOfToday()
};
const navButtons = Array.from(document.querySelectorAll("[data-view-target]"));
const openEventButtons = Array.from(document.querySelectorAll("[data-open-event-modal]"));
const views = Array.from(document.querySelectorAll(".view"));
const navMenu = document.querySelector("#nav-menu");
const eventDialog = document.querySelector("#event-dialog");
const closeEventModalButton = document.querySelector("#close-event-modal");
const form = document.querySelector("#event-form");
const formTitle = document.querySelector("#form-title");
const submitButton = document.querySelector("#submit-button");
const cancelEditButton = document.querySelector("#cancel-edit");
const formMessage = document.querySelector("#form-message");
const titleInput = document.querySelector("#title");
const dateInput = document.querySelector("#event-date");
const recurrenceTypeInput = document.querySelector("#recurrence-type");
const recurrenceIntervalRow = document.querySelector("#recurrence-interval-row");
const recurrenceIntervalInput = document.querySelector("#recurrence-interval");
const recurrenceUnitLabel = document.querySelector("#recurrence-unit-label");
const categoryInput = document.querySelector("#category-name");
const categoryColor = document.querySelector("#category-color");
const colorState = document.querySelector("#color-state");
const detailsEnabledInput = document.querySelector("#details-enabled");
const eventDetailsFields = document.querySelector("#event-details-fields");
const detailStartDateInput = document.querySelector("#detail-start-date");
const notesInput = document.querySelector("#notes");
const categoryOptions = document.querySelector("#category-options");
const eventList = document.querySelector("#event-list");
const categoryLegend = document.querySelector("#category-legend");
const filterSummaryCount = document.querySelector("#filter-summary-count");
const showAllCategoriesButton = document.querySelector("#show-all-categories");
const hideAllCategoriesButton = document.querySelector("#hide-all-categories");
const rangeDays = document.querySelector("#range-days");
const displayModeInputs = Array.from(document.querySelectorAll("input[name='displayMode']"));
const calendarToolbar = document.querySelector("#calendar-toolbar");
const calendarPeriodLabel = document.querySelector("#calendar-period-label");
const calendarPrevButton = document.querySelector("#calendar-prev");
const calendarTodayButton = document.querySelector("#calendar-today");
const calendarNextButton = document.querySelector("#calendar-next");
const calendarBoard = document.querySelector("#calendar-board");
const importForm = document.querySelector("#import-form");
const importFile = document.querySelector("#import-file");
const importFormat = document.querySelector("#import-format");
const importCategoryInput = document.querySelector("#import-category-name");
const importCategoryColor = document.querySelector("#import-category-color");
const importColorState = document.querySelector("#import-color-state");
const importMessage = document.querySelector("#import-message");
const eventDetailsSetting = document.querySelector("#event-details-setting");
const darkModeSetting = document.querySelector("#dark-mode-setting");
const settingsMessage = document.querySelector("#settings-message");
const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
});
const detailDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
});
const monthYearFormatter = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
});
const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
});
const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short"
});
navButtons.forEach((button)=>{
    button.addEventListener("click", ()=>{
        showView(button.dataset.viewTarget ?? "home");
        closeMenu();
    });
});
openEventButtons.forEach((button)=>{
    button.addEventListener("click", ()=>{
        showView("home");
        openEventModal();
        closeMenu();
    });
});
form.addEventListener("submit", handleSubmit);
cancelEditButton.addEventListener("click", closeEventModal);
closeEventModalButton.addEventListener("click", closeEventModal);
eventDialog.addEventListener("click", (event)=>{
    if (event.target === eventDialog) {
        closeEventModal();
    }
});
categoryInput.addEventListener("input", syncCategoryColor);
detailsEnabledInput.addEventListener("change", syncEventDetailsFields);
recurrenceTypeInput.addEventListener("change", syncRecurrenceFields);
recurrenceIntervalInput.addEventListener("input", syncRecurrenceFields);
rangeDays.addEventListener("change", refreshEvents);
showAllCategoriesButton.addEventListener("click", showAllCategories);
hideAllCategoriesButton.addEventListener("click", hideAllCategories);
displayModeInputs.forEach((input)=>{
    input.addEventListener("change", ()=>{
        if (input.checked) {
            state.displayMode = input.value;
            renderCurrentView();
        }
    });
});
calendarPrevButton.addEventListener("click", ()=>moveCalendarCursor(-1));
calendarTodayButton.addEventListener("click", ()=>{
    state.calendarCursor = startOfToday();
    renderCurrentView();
});
calendarNextButton.addEventListener("click", ()=>moveCalendarCursor(1));
importForm.addEventListener("submit", handleImport);
importCategoryInput.addEventListener("input", syncImportCategoryColor);
eventDetailsSetting.addEventListener("change", updateEventDetailsSetting);
darkModeSetting.addEventListener("change", updateEventDetailsSetting);
void initialize();
async function initialize() {
    setTodayAsDefault();
    syncRecurrenceFields();
    await refreshSettings();
    await refreshCategories();
    await refreshEvents();
    const initialHash = window.location.hash.replace("#", "");
    const initialView = viewFromHash();
    showView(initialView);
    if (initialHash === "add") {
        openEventModal();
    }
}
async function refreshSettings() {
    const data = await apiGet("/api/settings");
    state.settings = data.settings;
    eventDetailsSetting.checked = state.settings.eventDetailsEnabled;
    darkModeSetting.checked = state.settings.darkModeEnabled;
    applyTheme();
}
async function refreshCategories() {
    const data = await apiGet("/api/categories");
    state.categories = data.categories;
    pruneHiddenCategoryIds();
    renderCategories();
    syncCategoryColor();
    syncImportCategoryColor();
}
async function refreshEvents() {
    const data = await apiGet(`/api/events?days=${rangeDays.value}`);
    state.events = data.events;
    renderCurrentView();
}
async function updateEventDetailsSetting() {
    try {
        const data = await apiSend("/api/settings", "PUT", {
            eventDetailsEnabled: eventDetailsSetting.checked,
            darkModeEnabled: darkModeSetting.checked
        });
        state.settings = data.settings;
        eventDetailsSetting.checked = state.settings.eventDetailsEnabled;
        darkModeSetting.checked = state.settings.darkModeEnabled;
        applyTheme();
        settingsMessage.textContent = "Saved.";
        settingsMessage.classList.remove("error");
        renderCurrentView();
    } catch (error) {
        eventDetailsSetting.checked = state.settings.eventDetailsEnabled;
        darkModeSetting.checked = state.settings.darkModeEnabled;
        settingsMessage.textContent = error instanceof Error ? error.message : "Could not save setting.";
        settingsMessage.classList.add("error");
    }
}
function applyTheme() {
    document.documentElement.dataset.theme = state.settings.darkModeEnabled ? "dark" : "light";
}
function showView(viewName) {
    state.activeView = viewName;
    views.forEach((view)=>{
        view.classList.toggle("is-active", view.id === `${viewName}-view`);
    });
    navButtons.forEach((button)=>{
        button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
    });
    if (window.location.hash !== `#${viewName}`) {
        window.history.replaceState(null, "", `#${viewName}`);
    }
}
function viewFromHash() {
    const hash = window.location.hash.replace("#", "");
    if (hash === "settings") {
        return hash;
    }
    return "home";
}
function openEventModal() {
    if (!eventDialog.open) {
        eventDialog.showModal();
    }
    titleInput.focus();
}
function closeEventModal() {
    if (eventDialog.open) {
        eventDialog.close();
    }
    resetForm();
}
function closeMenu() {
    navMenu.open = false;
}
function renderCategories() {
    categoryOptions.innerHTML = state.categories.map((category)=>`<option value="${escapeHtml(category.name)}"></option>`).join("");
    updateFilterSummary();
    categoryLegend.innerHTML = state.categories.map((category)=>{
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
    }).join("");
    categoryLegend.querySelectorAll("[data-category-id]").forEach((button)=>{
        button.addEventListener("click", ()=>{
            toggleCategory(Number(button.dataset.categoryId));
        });
    });
}
function renderEvents() {
    const visibleEvents = state.events.filter((event)=>!state.hiddenCategoryIds.has(event.categoryId));
    calendarToolbar.classList.add("hidden");
    calendarBoard.classList.add("hidden");
    eventList.classList.remove("hidden");
    if (!state.events.length) {
        eventList.innerHTML = `<div class="empty-state">No events in this range.</div>`;
        return;
    }
    if (!visibleEvents.length) {
        eventList.innerHTML = `<div class="empty-state">No events match the selected calendars.</div>`;
        return;
    }
    eventList.innerHTML = visibleEvents.map(renderEventCard).join("");
    wireEventActions(eventList);
}
function wireEventActions(root) {
    root.querySelectorAll("[data-edit-id]").forEach((button)=>{
        button.addEventListener("click", ()=>{
            closeEventActionMenu(button);
            const id = Number(button.dataset.editId);
            const event = state.events.find((item)=>item.id === id);
            if (event) {
                startEditing(event);
            }
        });
    });
    root.querySelectorAll("[data-delete-id]").forEach((button)=>{
        button.addEventListener("click", async ()=>{
            closeEventActionMenu(button);
            const id = Number(button.dataset.deleteId);
            const event = state.events.find((item)=>item.id === id);
            if (!event || !confirm(`Delete "${event.title}"?`)) {
                return;
            }
            await deleteEvent(id);
        });
    });
    root.querySelectorAll(".event-actions-menu").forEach((menu)=>{
        menu.addEventListener("toggle", ()=>{
            const eventMenu = menu;
            if (eventMenu.open) {
                closeEventActionMenus(eventMenu);
            }
        });
    });
}
function renderCurrentView() {
    if (state.displayMode === "list") {
        renderEvents();
        return;
    }
    renderCalendarView();
}
function renderCalendarView() {
    const visibleEvents = state.events.filter((event)=>!state.hiddenCategoryIds.has(event.categoryId));
    const eventsByDate = groupEventsByDate(visibleEvents);
    calendarToolbar.classList.remove("hidden");
    calendarBoard.classList.remove("hidden");
    eventList.classList.add("hidden");
    calendarPeriodLabel.textContent = calendarPeriodText();
    if (state.displayMode === "month") {
        calendarBoard.innerHTML = renderMonthView(eventsByDate);
    } else if (state.displayMode === "week") {
        calendarBoard.innerHTML = renderWeekView(eventsByDate);
    } else {
        calendarBoard.innerHTML = renderDayView(eventsByDate);
    }
    calendarBoard.querySelectorAll("[data-calendar-date]").forEach((button)=>{
        button.addEventListener("click", ()=>{
            const dateValue = button.dataset.calendarDate;
            if (!dateValue) {
                return;
            }
            state.calendarCursor = parseDateOnly(dateValue);
            state.displayMode = "day";
            syncDisplayModeControls();
            renderCurrentView();
        });
    });
    wireEventActions(calendarBoard);
}
function renderMonthView(eventsByDate) {
    const cursor = state.calendarCursor;
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const start = startOfWeek(firstOfMonth);
    const end = endOfWeek(lastOfMonth);
    const days = datesBetween(start, end);
    return `
    <div class="calendar-weekdays">
      ${weekdayLabels().map((day)=>`<span>${day}</span>`).join("")}
    </div>
    <div class="calendar-grid calendar-grid-month">
      ${days.map((date)=>renderCalendarDayButton(date, eventsByDate, date.getMonth() === cursor.getMonth())).join("")}
    </div>
  `;
}
function renderWeekView(eventsByDate) {
    const start = startOfWeek(state.calendarCursor);
    const days = datesBetween(start, endOfWeek(state.calendarCursor));
    return `
    <div class="calendar-grid calendar-grid-week">
      ${days.map((date)=>renderCalendarDayButton(date, eventsByDate, true)).join("")}
    </div>
  `;
}
function renderDayView(eventsByDate) {
    const dateKey = toDateOnly(state.calendarCursor);
    const events = eventsByDate.get(dateKey) ?? [];
    const cards = events.length ? events.map(renderEventCard).join("") : `<div class="empty-state">No events on this day.</div>`;
    return `
    <section class="calendar-day-agenda">
      <div class="panel-heading">
        <p class="eyebrow">${weekdayFormatter.format(state.calendarCursor)}</p>
        <h2>${formatDateForDisplay(dateKey)}</h2>
      </div>
      <div class="event-list">${cards}</div>
    </section>
  `;
}
function renderCalendarDayButton(date, eventsByDate, inPrimaryPeriod) {
    const dateKey = toDateOnly(date);
    const events = eventsByDate.get(dateKey) ?? [];
    const classes = [
        "calendar-day",
        inPrimaryPeriod ? "" : "is-outside",
        sameDate(date, startOfToday()) ? "is-today" : "",
        events.length ? "has-events" : ""
    ].filter(Boolean).join(" ");
    return `
    <button class="${classes}" type="button" data-calendar-date="${dateKey}">
      <span class="calendar-day-heading">
        <span class="calendar-weekday">${weekdayFormatter.format(date)}</span>
        <span class="calendar-day-number">${date.getDate()}</span>
      </span>
      <span class="calendar-markers" aria-label="${events.length} events">
        ${events.slice(0, 5).map((event)=>`<span class="calendar-dot" style="background:${event.categoryColor}"></span>`).join("")}
      </span>
      <span class="calendar-items">
        ${events.slice(0, 3).map((event)=>`
          <span class="calendar-item">
            <span class="swatch" style="background:${event.categoryColor}"></span>
            ${escapeHtml(event.title)}
          </span>
        `).join("")}
        ${events.length > 3 ? `<span class="calendar-more">+${events.length - 3} more</span>` : ""}
      </span>
    </button>
  `;
}
function groupEventsByDate(events) {
    const eventsByDate = new Map();
    for (const event of events){
        const groupedEvents = eventsByDate.get(event.occurrenceDate) ?? [];
        groupedEvents.push(event);
        eventsByDate.set(event.occurrenceDate, groupedEvents);
    }
    return eventsByDate;
}
function moveCalendarCursor(direction) {
    if (state.displayMode === "month") {
        state.calendarCursor = addMonths(state.calendarCursor, direction);
    } else if (state.displayMode === "week") {
        state.calendarCursor = addDaysLocal(state.calendarCursor, direction * 7);
    } else {
        state.calendarCursor = addDaysLocal(state.calendarCursor, direction);
    }
    renderCurrentView();
}
function syncDisplayModeControls() {
    displayModeInputs.forEach((input)=>{
        input.checked = input.value === state.displayMode;
    });
}
function calendarPeriodText() {
    if (state.displayMode === "month") {
        return monthYearFormatter.format(state.calendarCursor);
    }
    if (state.displayMode === "week") {
        const start = startOfWeek(state.calendarCursor);
        const end = endOfWeek(state.calendarCursor);
        return `${shortDateFormatter.format(start)} - ${shortDateFormatter.format(end)}, ${end.getFullYear()}`;
    }
    return formatDateForDisplay(toDateOnly(state.calendarCursor));
}
function weekdayLabels() {
    return datesBetween(startOfWeek(startOfToday()), endOfWeek(startOfToday())).map((date)=>weekdayFormatter.format(date));
}
function toggleCategory(categoryId) {
    if (state.hiddenCategoryIds.has(categoryId)) {
        state.hiddenCategoryIds.delete(categoryId);
    } else {
        state.hiddenCategoryIds.add(categoryId);
    }
    saveHiddenCategoryIds();
    renderCategories();
    renderCurrentView();
}
function showAllCategories() {
    state.hiddenCategoryIds.clear();
    saveHiddenCategoryIds();
    renderCategories();
    renderCurrentView();
}
function hideAllCategories() {
    state.hiddenCategoryIds = new Set(state.categories.map((category)=>category.id));
    saveHiddenCategoryIds();
    renderCategories();
    renderCurrentView();
}
function updateFilterSummary() {
    const visibleCount = state.categories.filter((category)=>!state.hiddenCategoryIds.has(category.id)).length;
    if (!state.categories.length) {
        filterSummaryCount.textContent = "None";
    } else if (visibleCount === state.categories.length) {
        filterSummaryCount.textContent = "All shown";
    } else {
        filterSummaryCount.textContent = `${visibleCount} of ${state.categories.length} shown`;
    }
}
function pruneHiddenCategoryIds() {
    const validIds = new Set(state.categories.map((category)=>category.id));
    state.hiddenCategoryIds = new Set(Array.from(state.hiddenCategoryIds).filter((categoryId)=>validIds.has(categoryId)));
    saveHiddenCategoryIds();
}
function loadHiddenCategoryIds() {
    try {
        const storedValue = window.localStorage.getItem(CATEGORY_FILTER_STORAGE_KEY);
        if (!storedValue) {
            return new Set();
        }
        const parsed = JSON.parse(storedValue);
        if (!Array.isArray(parsed)) {
            return new Set();
        }
        return new Set(parsed.map((value)=>Number(value)).filter((value)=>Number.isInteger(value) && value > 0));
    } catch  {
        return new Set();
    }
}
function saveHiddenCategoryIds() {
    try {
        window.localStorage.setItem(CATEGORY_FILTER_STORAGE_KEY, JSON.stringify(Array.from(state.hiddenCategoryIds)));
    } catch  {}
}
function renderEventCard(event) {
    const canManage = event.source === "manual";
    const sourceLabel = labelForSource(event.source);
    const details = renderEventDetails(event);
    const menu = canManage ? `
      <details class="event-actions-menu">
        <summary class="event-menu-button" aria-label="Event actions">
          <span class="sr-only">Event actions</span>
        </summary>
        <div class="event-menu-list" role="menu">
          <button class="event-menu-item" type="button" role="menuitem" data-edit-id="${event.id}">Edit</button>
          <button class="event-menu-item is-danger" type="button" role="menuitem" data-delete-id="${event.id}">Delete</button>
        </div>
      </details>
    ` : "";
    return `
    <article class="event-card" style="--event-color:${event.categoryColor}">
      <div class="event-main">
        <div class="event-title-row">
          <h3 class="event-title">${escapeHtml(event.title)}</h3>
          ${menu}
        </div>
        <div class="event-meta">
          <span class="category-pill">
            <span class="swatch" style="background:${event.categoryColor}"></span>
            ${escapeHtml(event.categoryName)}
          </span>
          <span>${formatDateForDisplay(event.occurrenceDate)}</span>
          <span>${sourceLabel}</span>
        </div>
      </div>
      <div class="event-side">
        <div class="countdown" aria-label="${event.daysUntil} days until ${escapeHtml(event.title)}">
          <span class="countdown-value">${formatCountdown(event.occurrenceDate)}</span>
          <span class="countdown-label">${countdownLabel(event.daysUntil)}</span>
        </div>
      </div>
      ${details}
    </article>
  `;
}
function renderEventDetails(event) {
    if (!state.settings.eventDetailsEnabled) {
        return "";
    }
    const summary = event.detailSummary.trim();
    const startDate = event.detailStartDate.trim();
    const showCustomDetails = event.detailsEnabled && (summary || startDate);
    const showRecurrence = event.source === "manual";
    if (!showCustomDetails && !showRecurrence) {
        return "";
    }
    return `
    <details class="event-detail-panel">
      <summary>Details</summary>
      <div class="event-detail-content">
        ${showRecurrence ? `
              <div class="detail-row">
                <span>Repeats</span>
                <strong>${escapeHtml(event.recurrenceLabel)}</strong>
              </div>
            ` : ""}
        ${showCustomDetails && startDate ? `
              <div class="detail-row">
                <span>${escapeHtml(event.detailStartLabel || "Start date")}</span>
                <strong>${formatDetailDate(startDate)}</strong>
              </div>
            ` : ""}
        ${showCustomDetails && summary ? `<p>${escapeHtml(summary)}</p>` : ""}
      </div>
    </details>
  `;
}
function closeEventActionMenu(button) {
    const menu = button.closest("details");
    if (menu instanceof HTMLDetailsElement) {
        menu.open = false;
    }
}
function closeEventActionMenus(except) {
    document.querySelectorAll(".event-actions-menu").forEach((menu)=>{
        const eventMenu = menu;
        if (eventMenu !== except) {
            eventMenu.open = false;
        }
    });
}
async function handleSubmit(event) {
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
async function handleImport(event) {
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
        const result = await apiSend("/api/import", "POST", {
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
function getPayload() {
    return {
        title: titleInput.value.trim(),
        eventDate: dateInput.value,
        recurrence: recurrenceTypeInput.value,
        recurrenceInterval: recurrenceTypeInput.value === "none" ? 1 : Math.max(1, Number(recurrenceIntervalInput.value) || 1),
        categoryName: categoryInput.value.trim(),
        categoryColor: categoryColor.disabled ? "" : categoryColor.value,
        notes: notesInput.value.trim(),
        detailsEnabled: detailsEnabledInput.checked,
        detailStartDate: detailStartDateInput.value
    };
}
function startEditing(event) {
    state.editingId = event.id;
    titleInput.value = event.title;
    dateInput.value = event.eventDate;
    recurrenceTypeInput.value = event.recurrence;
    recurrenceIntervalInput.value = String(event.recurrenceInterval || 1);
    categoryInput.value = event.categoryName;
    categoryColor.value = event.categoryColor;
    detailsEnabledInput.checked = event.detailsEnabled;
    notesInput.value = event.detailSummary || event.notes || "";
    detailStartDateInput.value = event.detailStartDate ?? "";
    formTitle.textContent = "Edit event";
    submitButton.textContent = "Save changes";
    cancelEditButton.classList.remove("hidden");
    syncCategoryColor();
    syncEventDetailsFields();
    syncRecurrenceFields();
    showView("home");
    openEventModal();
}
function resetForm(clearMessage = true) {
    state.editingId = null;
    form.reset();
    setTodayAsDefault();
    formTitle.textContent = "Add event";
    submitButton.textContent = "Add event";
    cancelEditButton.classList.add("hidden");
    syncCategoryColor();
    syncEventDetailsFields();
    syncRecurrenceFields();
    if (clearMessage) {
        setMessage("");
    }
}
async function deleteEvent(id) {
    try {
        await apiSend(`/api/events/${id}`, "DELETE");
        await refreshEvents();
        setMessage("Event deleted.");
    } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not delete event.", true);
    }
}
function syncCategoryColor() {
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
function syncEventDetailsFields() {
    eventDetailsFields.classList.toggle("hidden", !detailsEnabledInput.checked);
}
function syncRecurrenceFields() {
    const recurrence = recurrenceTypeInput.value;
    const isRecurring = recurrence !== "none";
    recurrenceIntervalRow.classList.toggle("hidden", !isRecurring);
    const units = {
        daily: "day",
        weekly: "week",
        monthly: "month",
        annual: "year"
    };
    if (isRecurring) {
        const unit = units[recurrence];
        const interval = Math.max(1, Number(recurrenceIntervalInput.value) || 1);
        recurrenceUnitLabel.textContent = interval === 1 ? unit : `${unit}s`;
    }
}
function syncImportCategoryColor() {
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
function findCategory(name) {
    return state.categories.find((category)=>category.name.toLowerCase() === name.toLowerCase());
}
function setTodayAsDefault() {
    if (!dateInput.value) {
        dateInput.value = toDateOnly(new Date());
    }
}
function formatCountdown(dateString) {
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
    while(addMonths(cursor, 1) <= target){
        cursor = addMonths(cursor, 1);
        months += 1;
    }
    const remainingDays = Math.round((target.getTime() - cursor.getTime()) / 86_400_000);
    return joinParts([
        plural(months, "month"),
        remainingDays ? plural(remainingDays, "day") : ""
    ]);
}
function countdownLabel(days) {
    if (days === 0) {
        return "happening";
    }
    return "until";
}
function daysUntil(dateString) {
    const today = startOfToday().getTime();
    const target = parseDateOnly(dateString).getTime();
    return Math.round((target - today) / 86_400_000);
}
function parseDateOnly(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
}
function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function startOfWeek(date) {
    return addDaysLocal(date, -date.getDay());
}
function endOfWeek(date) {
    return addDaysLocal(startOfWeek(date), 6);
}
function addDaysLocal(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return new Date(next.getFullYear(), next.getMonth(), next.getDate());
}
function datesBetween(start, end) {
    const days = [];
    let cursor = new Date(start);
    while(cursor <= end){
        days.push(new Date(cursor));
        cursor = addDaysLocal(cursor, 1);
    }
    return days;
}
function sameDate(first, second) {
    return toDateOnly(first) === toDateOnly(second);
}
function addMonths(date, count) {
    const next = new Date(date);
    const originalDay = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + count);
    next.setDate(Math.min(originalDay, daysInMonth(next.getFullYear(), next.getMonth())));
    return next;
}
function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}
function plural(count, unit) {
    return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
function joinParts(parts) {
    return parts.filter(Boolean).join(", ");
}
function formatDateForDisplay(dateString) {
    return dateFormatter.format(parseDateOnly(dateString));
}
function formatDetailDate(dateString) {
    const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return escapeHtml(dateString);
    }
    const year = Number(match[1]);
    if (year < 1900) {
        return `${monthName(Number(match[2]))} ${Number(match[3])}, ${match[1]}`;
    }
    return detailDateFormatter.format(parseDateOnly(dateString));
}
function monthName(month) {
    const names = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec"
    ];
    return names[month - 1] ?? "Month";
}
function toDateOnly(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
function labelForSource(source) {
    if (source === "federal") {
        return "Federal";
    }
    if (source === "christian") {
        return "Christian";
    }
    return "Manual";
}
async function apiGet(url) {
    const response = await fetch(url);
    return handleResponse(response);
}
async function apiSend(url, method, payload) {
    const response = await fetch(url, {
        method,
        headers: payload ? {
            "Content-Type": "application/json"
        } : undefined,
        body: payload ? JSON.stringify(payload) : undefined
    });
    return handleResponse(response);
}
async function handleResponse(response) {
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json") ? await response.json() : undefined;
    if (!response.ok) {
        throw new Error(data?.error ?? `Request failed with ${response.status}`);
    }
    return data;
}
function setMessage(message, isError = false) {
    formMessage.textContent = message;
    formMessage.classList.toggle("error", isError);
}
function setImportMessage(message, isError = false) {
    importMessage.textContent = message;
    importMessage.classList.toggle("error", isError);
}
function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
