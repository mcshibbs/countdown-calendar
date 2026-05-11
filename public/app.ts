type Category = {
  id: number;
  name: string;
  color: string;
  builtin: boolean;
  ownerUserId: number | null;
  ownerDisplayName: string | null;
  calendarType: "builtin" | "personal" | "birthday" | "anniversary" | "custom" | "shared";
  canAddEvents: boolean;
  canShare: boolean;
  sharedWithMe: boolean;
};

type Recurrence = "none" | "daily" | "weekly" | "monthly" | "annual";
type DisplayMode = "list" | "month" | "week" | "day";
type EventSource = "manual" | "federal" | "christian" | "american";

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
  categoryOwnerUserId: number | null;
  categoryCalendarType: Category["calendarType"];
  categoryOwnerDisplayName: string | null;
  canEdit: boolean;
  recurrence: Recurrence;
  recurrenceInterval: number;
  recurrenceLabel: string;
  source: EventSource;
  notes: string;
  detailsEnabled: boolean;
  detailSummary: string;
  detailStartDate: string;
  detailStartLabel: string;
};

type EventPayload = {
  title: string;
  eventDate: string;
  recurrence: Recurrence;
  recurrenceInterval: number;
  categoryName: string;
  categoryColor: string;
  notes: string;
  detailsEnabled: boolean;
  detailStartDate: string;
};

type ImportResponse = {
  imported: number;
  skipped: number;
  errors: string[];
};

type ViewName = "home" | "settings";

const CATEGORY_FILTER_STORAGE_KEY = "countdown-calendar-hidden-categories";

type CurrentUser = {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  dateOfBirth: string;
  isAdmin: boolean;
};

type AuthSessionResponse = {
  authenticated: boolean;
  user?: CurrentUser;
  mfaRequired?: boolean;
  mfaSetup?: {
    secret: string;
    setupUri: string;
  };
  backupCodes?: string[];
};

type ShareItem = {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryColor: string;
  ownerUserId: number;
  ownerDisplayName: string;
  inviteeUserId: number | null;
  inviteeEmail: string;
  inviteeDisplayName: string | null;
  status: "pending" | "accepted" | "declined" | "revoked";
  createdAt: string;
  updatedAt: string;
};

type ShareState = {
  ownedCalendars: Category[];
  incoming: ShareItem[];
  outgoing: ShareItem[];
  sharedWithMe: ShareItem[];
};

type AppSettings = {
  eventDetailsEnabled: boolean;
  darkModeEnabled: boolean;
};

type AdminUser = {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  dateOfBirth: string;
  mfaEnabled: boolean;
  forceMfaSetup: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

type PendingInvite = {
  email: string;
  inviteCount: number;
  updatedAt: string;
};

type AdminSummary = {
  users: AdminUser[];
  pendingInvites: PendingInvite[];
};

const state: {
  categories: Category[];
  events: CalendarEvent[];
  editingId: number | null;
  activeView: ViewName;
  hiddenCategoryIds: Set<number>;
  settings: AppSettings;
  displayMode: DisplayMode;
  calendarCursor: Date;
  user: CurrentUser | null;
  mfaMode: "setup" | "verify";
  shares: ShareState | null;
  adminSummary: AdminSummary | null;
  latestBackupCodes: string[];
} = {
  categories: [],
  events: [],
  editingId: null,
  activeView: "home",
  hiddenCategoryIds: loadHiddenCategoryIds(),
  settings: { eventDetailsEnabled: true, darkModeEnabled: false },
  displayMode: "list",
  calendarCursor: startOfToday(),
  user: null,
  mfaMode: "setup",
  shares: null,
  adminSummary: null,
  latestBackupCodes: []
};

const navButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view-target]"));
const openEventButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-open-event-modal]"));
const views = Array.from(document.querySelectorAll<HTMLElement>(".view"));
const authShell = document.querySelector("#auth-shell") as HTMLElement;
const appShell = document.querySelector("#app-shell") as HTMLElement;
const adminShell = document.querySelector("#admin-shell") as HTMLElement;
const openLoginDialogButton = document.querySelector("#open-login-dialog") as HTMLButtonElement;
const openSignupDialogButton = document.querySelector("#open-signup-dialog") as HTMLButtonElement;
const loginDialog = document.querySelector("#login-dialog") as HTMLDialogElement;
const signupDialog = document.querySelector("#signup-dialog") as HTMLDialogElement;
const closeLoginDialogButton = document.querySelector("#close-login-dialog") as HTMLButtonElement;
const closeSignupDialogButton = document.querySelector("#close-signup-dialog") as HTMLButtonElement;
const loginForm = document.querySelector("#login-form") as HTMLFormElement;
const loginMfaForm = document.querySelector("#login-mfa-form") as HTMLFormElement;
const signupForm = document.querySelector("#signup-form") as HTMLFormElement;
const loginEmail = document.querySelector("#login-email") as HTMLInputElement;
const loginPassword = document.querySelector("#login-password") as HTMLInputElement;
const loginMessage = document.querySelector("#login-message") as HTMLParagraphElement;
const loginMfaCode = document.querySelector("#login-mfa-code") as HTMLInputElement;
const loginMfaMessage = document.querySelector("#login-mfa-message") as HTMLParagraphElement;
const signupFirstName = document.querySelector("#signup-first-name") as HTMLInputElement;
const signupLastName = document.querySelector("#signup-last-name") as HTMLInputElement;
const signupDisplayName = document.querySelector("#signup-display-name") as HTMLInputElement;
const signupEmail = document.querySelector("#signup-email") as HTMLInputElement;
const signupDateOfBirth = document.querySelector("#signup-date-of-birth") as HTMLInputElement;
const signupPassword = document.querySelector("#signup-password") as HTMLInputElement;
const signupConfirmPassword = document.querySelector("#signup-confirm-password") as HTMLInputElement;
const signupMessage = document.querySelector("#signup-message") as HTMLParagraphElement;
const mfaPanel = document.querySelector("#mfa-panel") as HTMLElement;
const mfaForm = document.querySelector("#mfa-form") as HTMLFormElement;
const mfaSecret = document.querySelector("#mfa-secret") as HTMLInputElement;
const mfaUri = document.querySelector("#mfa-uri") as HTMLInputElement;
const mfaCode = document.querySelector("#mfa-code") as HTMLInputElement;
const mfaMessage = document.querySelector("#mfa-message") as HTMLParagraphElement;
const backupCodesPanel = document.querySelector("#backup-codes-panel") as HTMLElement;
const backupCodesOutput = document.querySelector("#backup-codes-output") as HTMLTextAreaElement;
const downloadSignupBackupCodesButton = document.querySelector("#download-signup-backup-codes") as HTMLButtonElement;
const finishSignupButton = document.querySelector("#finish-signup") as HTMLButtonElement;
const authMessage = document.querySelector("#auth-message") as HTMLParagraphElement;
const navMenu = document.querySelector("#nav-menu") as HTMLDetailsElement;
const userBadge = document.querySelector("#user-badge") as HTMLParagraphElement;
const logoutButton = document.querySelector("#logout-button") as HTMLButtonElement;
const adminUserBadge = document.querySelector("#admin-user-badge") as HTMLParagraphElement;
const adminLogoutButton = document.querySelector("#admin-logout-button") as HTMLButtonElement;
const adminUsers = document.querySelector("#admin-users") as HTMLDivElement;
const adminPendingInvites = document.querySelector("#admin-pending-invites") as HTMLDivElement;
const eventDialog = document.querySelector("#event-dialog") as HTMLDialogElement;
const closeEventModalButton = document.querySelector("#close-event-modal") as HTMLButtonElement;

const form = document.querySelector("#event-form") as HTMLFormElement;
const formTitle = document.querySelector("#form-title") as HTMLHeadingElement;
const submitButton = document.querySelector("#submit-button") as HTMLButtonElement;
const cancelEditButton = document.querySelector("#cancel-edit") as HTMLButtonElement;
const formMessage = document.querySelector("#form-message") as HTMLParagraphElement;
const titleInput = document.querySelector("#title") as HTMLInputElement;
const dateInput = document.querySelector("#event-date") as HTMLInputElement;
const recurrenceTypeInput = document.querySelector("#recurrence-type") as HTMLSelectElement;
const recurrenceIntervalRow = document.querySelector("#recurrence-interval-row") as HTMLDivElement;
const recurrenceIntervalInput = document.querySelector("#recurrence-interval") as HTMLInputElement;
const recurrenceUnitLabel = document.querySelector("#recurrence-unit-label") as HTMLDivElement;
const categoryInput = document.querySelector("#category-name") as HTMLInputElement;
const categoryColor = document.querySelector("#category-color") as HTMLInputElement;
const colorState = document.querySelector("#color-state") as HTMLDivElement;
const detailsEnabledInput = document.querySelector("#details-enabled") as HTMLInputElement;
const eventDetailsFields = document.querySelector("#event-details-fields") as HTMLDivElement;
const detailStartDateInput = document.querySelector("#detail-start-date") as HTMLInputElement;
const notesInput = document.querySelector("#notes") as HTMLTextAreaElement;
const categoryOptions = document.querySelector("#category-options") as HTMLDataListElement;
const eventList = document.querySelector("#event-list") as HTMLDivElement;
const categoryLegend = document.querySelector("#category-legend") as HTMLDivElement;
const filterSummaryCount = document.querySelector("#filter-summary-count") as HTMLSpanElement;
const showAllCategoriesButton = document.querySelector("#show-all-categories") as HTMLButtonElement;
const hideAllCategoriesButton = document.querySelector("#hide-all-categories") as HTMLButtonElement;
const rangeDays = document.querySelector("#range-days") as HTMLSelectElement;
const displayModeInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[name='displayMode']"));
const calendarToolbar = document.querySelector("#calendar-toolbar") as HTMLDivElement;
const calendarPeriodLabel = document.querySelector("#calendar-period-label") as HTMLElement;
const calendarPrevButton = document.querySelector("#calendar-prev") as HTMLButtonElement;
const calendarTodayButton = document.querySelector("#calendar-today") as HTMLButtonElement;
const calendarNextButton = document.querySelector("#calendar-next") as HTMLButtonElement;
const calendarBoard = document.querySelector("#calendar-board") as HTMLDivElement;

const importForm = document.querySelector("#import-form") as HTMLFormElement;
const importFile = document.querySelector("#import-file") as HTMLInputElement;
const importFormat = document.querySelector("#import-format") as HTMLSelectElement;
const importCategoryInput = document.querySelector("#import-category-name") as HTMLInputElement;
const importCategoryColor = document.querySelector("#import-category-color") as HTMLInputElement;
const importColorState = document.querySelector("#import-color-state") as HTMLDivElement;
const importMessage = document.querySelector("#import-message") as HTMLParagraphElement;
const eventDetailsSetting = document.querySelector("#event-details-setting") as HTMLInputElement;
const darkModeSetting = document.querySelector("#dark-mode-setting") as HTMLInputElement;
const settingsMessage = document.querySelector("#settings-message") as HTMLParagraphElement;
const settingsBackupCodesButton = document.querySelector("#settings-backup-codes") as HTMLButtonElement;
const openMfaResetButton = document.querySelector("#open-mfa-reset") as HTMLButtonElement;
const securityMessage = document.querySelector("#security-message") as HTMLParagraphElement;
const mfaResetDialog = document.querySelector("#mfa-reset-dialog") as HTMLDialogElement;
const closeMfaResetButton = document.querySelector("#close-mfa-reset") as HTMLButtonElement;
const mfaResetPasswordForm = document.querySelector("#mfa-reset-password-form") as HTMLFormElement;
const mfaResetPassword = document.querySelector("#mfa-reset-password") as HTMLInputElement;
const mfaResetPasswordMessage = document.querySelector("#mfa-reset-password-message") as HTMLParagraphElement;
const mfaResetSetup = document.querySelector("#mfa-reset-setup") as HTMLElement;
const mfaResetSecret = document.querySelector("#mfa-reset-secret") as HTMLInputElement;
const mfaResetUri = document.querySelector("#mfa-reset-uri") as HTMLInputElement;
const mfaResetConfirmForm = document.querySelector("#mfa-reset-confirm-form") as HTMLFormElement;
const mfaResetCode = document.querySelector("#mfa-reset-code") as HTMLInputElement;
const mfaResetConfirmMessage = document.querySelector("#mfa-reset-confirm-message") as HTMLParagraphElement;
const shareForm = document.querySelector("#share-form") as HTMLFormElement;
const shareCalendar = document.querySelector("#share-calendar") as HTMLSelectElement;
const shareEmail = document.querySelector("#share-email") as HTMLInputElement;
const shareMessage = document.querySelector("#share-message") as HTMLParagraphElement;
const incomingShares = document.querySelector("#incoming-shares") as HTMLDivElement;
const outgoingShares = document.querySelector("#outgoing-shares") as HTMLDivElement;
const acceptedShares = document.querySelector("#accepted-shares") as HTMLDivElement;
const sharedCalendarForm = document.querySelector("#shared-calendar-form") as HTMLFormElement;
const sharedCalendarName = document.querySelector("#shared-calendar-name") as HTMLInputElement;
const sharedCalendarColor = document.querySelector("#shared-calendar-color") as HTMLInputElement;
const sharedCalendarEmail = document.querySelector("#shared-calendar-email") as HTMLInputElement;
const sharedCalendarMessage = document.querySelector("#shared-calendar-message") as HTMLParagraphElement;

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

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showView((button.dataset.viewTarget ?? "home") as ViewName);
    closeMenu();
  });
});

openLoginDialogButton.addEventListener("click", openLoginDialog);
openSignupDialogButton.addEventListener("click", openSignupDialog);
closeLoginDialogButton.addEventListener("click", () => loginDialog.close());
closeSignupDialogButton.addEventListener("click", () => signupDialog.close());
loginForm.addEventListener("submit", handleLogin);
loginMfaForm.addEventListener("submit", handleLoginMfa);
signupForm.addEventListener("submit", handleSignup);
mfaForm.addEventListener("submit", handleMfa);
logoutButton.addEventListener("click", handleLogout);
adminLogoutButton.addEventListener("click", handleLogout);
downloadSignupBackupCodesButton.addEventListener("click", () => downloadBackupCodes(state.latestBackupCodes));
finishSignupButton.addEventListener("click", () => {
  signupDialog.close();
  if (state.user) {
    void loadApp(state.user);
  }
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
detailsEnabledInput.addEventListener("change", syncEventDetailsFields);
recurrenceTypeInput.addEventListener("change", syncRecurrenceFields);
recurrenceIntervalInput.addEventListener("input", syncRecurrenceFields);
rangeDays.addEventListener("change", refreshEvents);
showAllCategoriesButton.addEventListener("click", showAllCategories);
hideAllCategoriesButton.addEventListener("click", hideAllCategories);
displayModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      state.displayMode = input.value as DisplayMode;
      renderCurrentView();
    }
  });
});
calendarPrevButton.addEventListener("click", () => moveCalendarCursor(-1));
calendarTodayButton.addEventListener("click", () => {
  state.calendarCursor = startOfToday();
  renderCurrentView();
});
calendarNextButton.addEventListener("click", () => moveCalendarCursor(1));

importForm.addEventListener("submit", handleImport);
importCategoryInput.addEventListener("input", syncImportCategoryColor);
eventDetailsSetting.addEventListener("change", updateEventDetailsSetting);
darkModeSetting.addEventListener("change", updateEventDetailsSetting);
settingsBackupCodesButton.addEventListener("click", handleGenerateBackupCodes);
openMfaResetButton.addEventListener("click", openMfaResetDialog);
mfaResetPasswordForm.addEventListener("submit", handleMfaResetStart);
mfaResetConfirmForm.addEventListener("submit", handleMfaResetConfirm);
closeMfaResetButton.addEventListener("click", closeMfaResetDialog);
shareForm.addEventListener("submit", handleShareInvite);
sharedCalendarForm.addEventListener("submit", handleSharedCalendarCreate);

void initialize();

async function initialize(): Promise<void> {
  setTodayAsDefault();
  syncRecurrenceFields();
  const session = await apiGet<AuthSessionResponse>("/api/auth/session");
  if (!session.authenticated || !session.user) {
    showAuth(session);
    return;
  }

  await loadApp(session.user);
}

async function loadApp(user: CurrentUser): Promise<void> {
  state.user = user;
  authShell.classList.add("hidden");
  loginDialog.close();
  signupDialog.close();

  if (user.isAdmin) {
    appShell.classList.add("hidden");
    adminShell.classList.remove("hidden");
    adminUserBadge.textContent = `${user.displayName} (${user.email})`;
    await refreshAdminSummary();
    return;
  }

  userBadge.textContent = `${user.displayName} (${user.email})`;
  adminShell.classList.add("hidden");
  appShell.classList.remove("hidden");
  await refreshSettings();
  await refreshCategories();
  await refreshShares();
  await refreshEvents();
  const initialHash = window.location.hash.replace("#", "");
  const initialView = viewFromHash();
  showView(initialView);

  if (initialHash === "add") {
    openEventModal();
  }
}

function showAuth(session: AuthSessionResponse = { authenticated: false }): void {
  state.user = session.user ?? null;
  appShell.classList.add("hidden");
  adminShell.classList.add("hidden");
  authShell.classList.remove("hidden");

  if (session.mfaSetup) {
    state.mfaMode = "setup";
    loginDialog.close();
    if (!signupDialog.open) {
      signupDialog.showModal();
    }
    signupForm.classList.add("hidden");
    mfaPanel.classList.remove("hidden");
    backupCodesPanel.classList.add("hidden");
    mfaSecret.value = session.mfaSetup.secret;
    mfaUri.value = session.mfaSetup.setupUri;
    setMfaMessage("Add this key to an authenticator app, then enter the current code.");
    mfaCode.focus();
    return;
  }

  if (session.mfaRequired) {
    state.mfaMode = "verify";
    signupDialog.close();
    if (!loginDialog.open) {
      loginDialog.showModal();
    }
    loginForm.classList.add("hidden");
    loginMfaForm.classList.remove("hidden");
    setLoginMfaMessage("Enter your authenticator or backup code.");
    loginMfaCode.focus();
    return;
  }

  loginForm.classList.remove("hidden");
  loginMfaForm.classList.add("hidden");
  signupForm.classList.remove("hidden");
  mfaPanel.classList.add("hidden");
  backupCodesPanel.classList.add("hidden");
}

function openLoginDialog(): void {
  setAuthMessage("");
  setLoginMessage("");
  setLoginMfaMessage("");
  loginForm.classList.remove("hidden");
  loginMfaForm.classList.add("hidden");
  if (!loginDialog.open) {
    loginDialog.showModal();
  }
  loginEmail.focus();
}

function openSignupDialog(): void {
  setAuthMessage("");
  setSignupMessage("");
  setMfaMessage("");
  signupForm.classList.remove("hidden");
  mfaPanel.classList.add("hidden");
  backupCodesPanel.classList.add("hidden");
  if (!signupDialog.open) {
    signupDialog.showModal();
  }
  signupFirstName.focus();
}

async function handleLogin(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setLoginMessage("");
  try {
    const session = await apiSend<AuthSessionResponse>("/api/auth/login", "POST", {
      email: loginEmail.value.trim(),
      password: loginPassword.value
    });
    if (session.authenticated && session.user) {
      await loadApp(session.user);
    } else {
      showAuth(session);
    }
  } catch (error) {
    setLoginMessage(error instanceof Error ? error.message : "Login failed.", true);
  }
}

async function handleLoginMfa(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setLoginMfaMessage("");
  try {
    const session = await apiSend<AuthSessionResponse>("/api/auth/mfa/verify", "POST", {
      code: loginMfaCode.value.trim()
    });
    loginMfaCode.value = "";
    if (session.authenticated && session.user) {
      await loadApp(session.user);
    }
  } catch (error) {
    setLoginMfaMessage(error instanceof Error ? error.message : "Authenticator or backup code failed.", true);
  }
}

async function handleSignup(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setSignupMessage("");
  try {
    const session = await apiSend<AuthSessionResponse>("/api/auth/signup", "POST", {
      firstName: signupFirstName.value.trim(),
      lastName: signupLastName.value.trim(),
      displayName: signupDisplayName.value.trim(),
      email: signupEmail.value.trim(),
      dateOfBirth: signupDateOfBirth.value,
      password: signupPassword.value,
      confirmPassword: signupConfirmPassword.value
    });
    showAuth(session);
  } catch (error) {
    setSignupMessage(error instanceof Error ? error.message : "Signup failed.", true);
  }
}

async function handleMfa(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setMfaMessage("");
  try {
    const endpoint = state.mfaMode === "setup" ? "/api/auth/mfa/enable" : "/api/auth/mfa/verify";
    const session = await apiSend<AuthSessionResponse>(endpoint, "POST", {
      code: mfaCode.value.trim()
    });
    mfaCode.value = "";
    if (session.backupCodes?.length) {
      state.latestBackupCodes = session.backupCodes;
      backupCodesOutput.value = session.backupCodes.join("\n");
      mfaPanel.classList.add("hidden");
      backupCodesPanel.classList.remove("hidden");
      if (session.user) {
        state.user = session.user;
      }
      return;
    }
    if (session.authenticated && session.user) {
      await loadApp(session.user);
    }
  } catch (error) {
    setMfaMessage(error instanceof Error ? error.message : "Authenticator code failed.", true);
  }
}

async function handleLogout(): Promise<void> {
  await apiSend("/api/auth/logout", "POST");
  state.events = [];
  state.categories = [];
  state.shares = null;
  state.adminSummary = null;
  adminShell.classList.add("hidden");
  appShell.classList.add("hidden");
  showAuth();
  closeMenu();
}

async function refreshSettings(): Promise<void> {
  const data = await apiGet<{ settings: AppSettings }>("/api/settings");
  state.settings = data.settings;
  eventDetailsSetting.checked = state.settings.eventDetailsEnabled;
  darkModeSetting.checked = state.settings.darkModeEnabled;
  applyTheme();
}

async function refreshCategories(): Promise<void> {
  const data = await apiGet<{ categories: Category[] }>("/api/categories");
  state.categories = data.categories;
  pruneHiddenCategoryIds();
  renderCategories();
  renderShareCalendarOptions();
  syncCategoryColor();
  syncImportCategoryColor();
}

async function refreshEvents(): Promise<void> {
  const data = await apiGet<{ events: CalendarEvent[] }>(`/api/events?days=${rangeDays.value}`);
  state.events = data.events;
  renderCurrentView();
}

async function refreshShares(): Promise<void> {
  const data = await apiGet<ShareState>("/api/shares");
  state.shares = data;
  renderShareCalendarOptions();
  renderShares();
}

async function refreshAdminSummary(): Promise<void> {
  const data = await apiGet<AdminSummary>("/api/admin/summary");
  state.adminSummary = data;
  renderAdminSummary();
}

async function updateEventDetailsSetting(): Promise<void> {
  try {
    const data = await apiSend<{ settings: AppSettings }>("/api/settings", "PUT", {
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

function applyTheme(): void {
  document.documentElement.dataset.theme = state.settings.darkModeEnabled ? "dark" : "light";
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
    .filter((category) => category.canAddEvents)
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
          ${escapeHtml(categoryLabel(category))}
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

function renderShareCalendarOptions(): void {
  const ownedCalendars = state.shares?.ownedCalendars ?? state.categories.filter((category) => category.canShare);
  shareCalendar.innerHTML = ownedCalendars.length
    ? ownedCalendars
      .map((category) => `<option value="${category.id}">${escapeHtml(categoryLabel(category))}</option>`)
      .join("")
    : `<option value="">No owned calendars</option>`;
  shareCalendar.disabled = ownedCalendars.length === 0;
}

function renderShares(): void {
  const shares = state.shares;
  if (!shares) {
    incomingShares.innerHTML = "";
    outgoingShares.innerHTML = "";
    acceptedShares.innerHTML = "";
    return;
  }

  incomingShares.innerHTML = shares.incoming.length
    ? shares.incoming.map(renderIncomingShare).join("")
    : `<div class="empty-inline">No pending invitations.</div>`;
  outgoingShares.innerHTML = shares.outgoing.length
    ? shares.outgoing.map(renderOutgoingShare).join("")
    : `<div class="empty-inline">Nothing shared yet.</div>`;
  acceptedShares.innerHTML = shares.sharedWithMe.length
    ? shares.sharedWithMe.map(renderAcceptedShare).join("")
    : `<div class="empty-inline">No shared calendars accepted.</div>`;

  incomingShares.querySelectorAll("[data-share-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = button as HTMLButtonElement;
      await respondToInvitation(Number(target.dataset.shareId), target.dataset.shareAction ?? "");
    });
  });

  outgoingShares.querySelectorAll("[data-revoke-share]").forEach((button) => {
    button.addEventListener("click", async () => {
      await revokeShare(Number((button as HTMLButtonElement).dataset.revokeShare));
    });
  });
}

function renderAdminSummary(): void {
  const summary = state.adminSummary;
  if (!summary) {
    adminUsers.innerHTML = "";
    adminPendingInvites.innerHTML = "";
    return;
  }

  adminUsers.innerHTML = summary.users.length
    ? summary.users.map(renderAdminUser).join("")
    : `<div class="empty-inline">No users yet.</div>`;
  adminPendingInvites.innerHTML = summary.pendingInvites.length
    ? summary.pendingInvites.map((invite) => `
      <article class="share-item">
        <div>
          <strong>${escapeHtml(invite.email)}</strong>
          <span>${invite.inviteCount} pending invitation${invite.inviteCount === 1 ? "" : "s"}</span>
        </div>
      </article>
    `).join("")
    : `<div class="empty-inline">No pending invited users.</div>`;

  adminUsers.querySelectorAll<HTMLFormElement>("[data-admin-user-form]").forEach((formElement) => {
    formElement.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveAdminUser(Number(formElement.dataset.userId), formElement);
    });
  });

  adminUsers.querySelectorAll<HTMLFormElement>("[data-admin-password-form]").forEach((formElement) => {
    formElement.addEventListener("submit", async (event) => {
      event.preventDefault();
      await resetAdminUserPassword(Number(formElement.dataset.userId), formElement);
    });
  });

  adminUsers.querySelectorAll<HTMLButtonElement>("[data-admin-mfa-reset]").forEach((button) => {
    button.addEventListener("click", async () => {
      await requireAdminUserMfaReset(Number(button.dataset.adminMfaReset));
    });
  });
}

function renderAdminUser(user: AdminUser): string {
  const statusParts = [
    user.isAdmin ? "Admin" : "User",
    user.mfaEnabled ? "MFA enabled" : "MFA setup required",
    user.forceMfaSetup ? "Reconfigure required" : ""
  ].filter(Boolean).join(" - ");

  return `
    <article class="admin-user-card">
      <div class="admin-user-heading">
        <div>
          <strong>${escapeHtml(user.displayName)}</strong>
          <span>${escapeHtml(user.email)} - ${escapeHtml(statusParts)}</span>
        </div>
      </div>
      <form class="admin-user-form" data-admin-user-form data-user-id="${user.id}">
        <div class="form-row">
          <label>
            <span>First name</span>
            <input name="firstName" value="${escapeHtml(user.firstName)}" required>
          </label>
          <label>
            <span>Last name</span>
            <input name="lastName" value="${escapeHtml(user.lastName)}" required>
          </label>
        </div>
        <div class="form-row">
          <label>
            <span>Display name</span>
            <input name="displayName" value="${escapeHtml(user.displayName)}" required>
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" value="${escapeHtml(user.email)}" required>
          </label>
        </div>
        <label>
          <span>Date of birth</span>
          <input name="dateOfBirth" type="date" value="${escapeHtml(user.dateOfBirth)}" required>
        </label>
        <button class="button button-primary" type="submit">Save details</button>
        <p class="form-message" data-admin-user-message></p>
      </form>
      <form class="admin-user-form" data-admin-password-form data-user-id="${user.id}">
        <label>
          <span>New password</span>
          <input name="password" type="password" minlength="10" autocomplete="new-password" required>
        </label>
        <button class="button button-ghost" type="submit">Reset password</button>
        <p class="form-message" data-admin-password-message></p>
      </form>
      <button class="button button-ghost" type="button" data-admin-mfa-reset="${user.id}">
        Require MFA reconfiguration
      </button>
    </article>
  `;
}

function renderIncomingShare(share: ShareItem): string {
  return `
    <article class="share-item">
      <div>
        <strong>${escapeHtml(share.categoryName)}</strong>
        <span>from ${escapeHtml(share.ownerDisplayName)}</span>
      </div>
      <div class="share-actions">
        <button class="button button-ghost" type="button" data-share-id="${share.id}" data-share-action="decline">Decline</button>
        <button class="button button-primary" type="button" data-share-id="${share.id}" data-share-action="accept">Accept</button>
      </div>
    </article>
  `;
}

function renderOutgoingShare(share: ShareItem): string {
  return `
    <article class="share-item">
      <div>
        <strong>${escapeHtml(share.categoryName)}</strong>
        <span>${escapeHtml(share.inviteeDisplayName ?? share.inviteeEmail)} - ${escapeHtml(share.status)}</span>
      </div>
      <button class="button button-ghost" type="button" data-revoke-share="${share.id}">Revoke</button>
    </article>
  `;
}

function renderAcceptedShare(share: ShareItem): string {
  return `
    <article class="share-item">
      <div>
        <strong>${escapeHtml(share.categoryName)}</strong>
        <span>from ${escapeHtml(share.ownerDisplayName)}</span>
      </div>
    </article>
  `;
}

function renderEvents(): void {
  const visibleEvents = state.events.filter((event) => !state.hiddenCategoryIds.has(event.categoryId));
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

function wireEventActions(root: ParentNode): void {
  root.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      closeEventActionMenu(button as HTMLButtonElement);
      const id = Number((button as HTMLButtonElement).dataset.editId);
      const event = state.events.find((item) => item.id === id);
      if (event) {
        startEditing(event);
      }
    });
  });

  root.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      closeEventActionMenu(button as HTMLButtonElement);
      const id = Number((button as HTMLButtonElement).dataset.deleteId);
      const event = state.events.find((item) => item.id === id);
      if (!event || !confirm(`Delete "${event.title}"?`)) {
        return;
      }
      await deleteEvent(id);
    });
  });

  root.querySelectorAll(".event-actions-menu").forEach((menu) => {
    menu.addEventListener("toggle", () => {
      const eventMenu = menu as HTMLDetailsElement;
      if (eventMenu.open) {
        closeEventActionMenus(eventMenu);
      }
    });
  });
}

function renderCurrentView(): void {
  if (state.displayMode === "list") {
    renderEvents();
    return;
  }

  renderCalendarView();
}

function renderCalendarView(): void {
  const visibleEvents = state.events.filter((event) => !state.hiddenCategoryIds.has(event.categoryId));
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

  calendarBoard.querySelectorAll("[data-calendar-date]").forEach((button) => {
    button.addEventListener("click", () => {
      const dateValue = (button as HTMLButtonElement).dataset.calendarDate;
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

function renderMonthView(eventsByDate: Map<string, CalendarEvent[]>): string {
  const cursor = state.calendarCursor;
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const start = startOfWeek(firstOfMonth);
  const end = endOfWeek(lastOfMonth);
  const days = datesBetween(start, end);

  return `
    <div class="calendar-weekdays">
      ${weekdayLabels().map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="calendar-grid calendar-grid-month">
      ${days.map((date) => renderCalendarDayButton(date, eventsByDate, date.getMonth() === cursor.getMonth())).join("")}
    </div>
  `;
}

function renderWeekView(eventsByDate: Map<string, CalendarEvent[]>): string {
  const start = startOfWeek(state.calendarCursor);
  const days = datesBetween(start, endOfWeek(state.calendarCursor));

  return `
    <div class="calendar-grid calendar-grid-week">
      ${days.map((date) => renderCalendarDayButton(date, eventsByDate, true)).join("")}
    </div>
  `;
}

function renderDayView(eventsByDate: Map<string, CalendarEvent[]>): string {
  const dateKey = toDateOnly(state.calendarCursor);
  const events = eventsByDate.get(dateKey) ?? [];
  const cards = events.length
    ? events.map(renderEventCard).join("")
    : `<div class="empty-state">No events on this day.</div>`;

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

function renderCalendarDayButton(
  date: Date,
  eventsByDate: Map<string, CalendarEvent[]>,
  inPrimaryPeriod: boolean
): string {
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
        ${events.slice(0, 5).map((event) => `<span class="calendar-dot" style="background:${event.categoryColor}"></span>`).join("")}
      </span>
      <span class="calendar-items">
        ${events.slice(0, 3).map((event) => `
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

function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const eventsByDate = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const groupedEvents = eventsByDate.get(event.occurrenceDate) ?? [];
    groupedEvents.push(event);
    eventsByDate.set(event.occurrenceDate, groupedEvents);
  }

  return eventsByDate;
}

function moveCalendarCursor(direction: -1 | 1): void {
  if (state.displayMode === "month") {
    state.calendarCursor = addMonths(state.calendarCursor, direction);
  } else if (state.displayMode === "week") {
    state.calendarCursor = addDaysLocal(state.calendarCursor, direction * 7);
  } else {
    state.calendarCursor = addDaysLocal(state.calendarCursor, direction);
  }

  renderCurrentView();
}

function syncDisplayModeControls(): void {
  displayModeInputs.forEach((input) => {
    input.checked = input.value === state.displayMode;
  });
}

function calendarPeriodText(): string {
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

function weekdayLabels(): string[] {
  return datesBetween(startOfWeek(startOfToday()), endOfWeek(startOfToday()))
    .map((date) => weekdayFormatter.format(date));
}

function toggleCategory(categoryId: number): void {
  if (state.hiddenCategoryIds.has(categoryId)) {
    state.hiddenCategoryIds.delete(categoryId);
  } else {
    state.hiddenCategoryIds.add(categoryId);
  }

  saveHiddenCategoryIds();
  renderCategories();
  renderCurrentView();
}

function showAllCategories(): void {
  state.hiddenCategoryIds.clear();
  saveHiddenCategoryIds();
  renderCategories();
  renderCurrentView();
}

function hideAllCategories(): void {
  state.hiddenCategoryIds = new Set(state.categories.map((category) => category.id));
  saveHiddenCategoryIds();
  renderCategories();
  renderCurrentView();
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
  const canManage = event.canEdit;
  const sourceLabel = labelForSource(event.source);
  const details = renderEventDetails(event);
  const menu = canManage
    ? `
      <details class="event-actions-menu">
        <summary class="event-menu-button" aria-label="Event actions">
          <span class="sr-only">Event actions</span>
        </summary>
        <div class="event-menu-list" role="menu">
          <button class="event-menu-item" type="button" role="menuitem" data-edit-id="${event.id}">Edit</button>
          <button class="event-menu-item is-danger" type="button" role="menuitem" data-delete-id="${event.id}">Delete</button>
        </div>
      </details>
    `
    : "";

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
            ${escapeHtml(eventCategoryLabel(event))}
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

function renderEventDetails(event: CalendarEvent): string {
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
        ${
          showRecurrence
            ? `
              <div class="detail-row">
                <span>Repeats</span>
                <strong>${escapeHtml(event.recurrenceLabel)}</strong>
              </div>
            `
            : ""
        }
        ${
          showCustomDetails && startDate
            ? `
              <div class="detail-row">
                <span>${escapeHtml(event.detailStartLabel || "Start date")}</span>
                <strong>${formatDetailDate(startDate)}</strong>
              </div>
            `
            : ""
        }
        ${showCustomDetails && summary ? `<p>${escapeHtml(summary)}</p>` : ""}
      </div>
    </details>
  `;
}

function closeEventActionMenu(button: HTMLButtonElement): void {
  const menu = button.closest("details");
  if (menu instanceof HTMLDetailsElement) {
    menu.open = false;
  }
}

function closeEventActionMenus(except?: HTMLDetailsElement): void {
  document.querySelectorAll(".event-actions-menu").forEach((menu) => {
    const eventMenu = menu as HTMLDetailsElement;
    if (eventMenu !== except) {
      eventMenu.open = false;
    }
  });
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

async function handleGenerateBackupCodes(): Promise<void> {
  setSecurityMessage("");
  try {
    const result = await apiSend<{ backupCodes: string[] }>("/api/security/backup-codes", "POST");
    downloadBackupCodes(result.backupCodes);
    setSecurityMessage("New backup codes downloaded.");
  } catch (error) {
    setSecurityMessage(error instanceof Error ? error.message : "Could not generate backup codes.", true);
  }
}

function openMfaResetDialog(): void {
  setSecurityMessage("");
  mfaResetPasswordForm.classList.remove("hidden");
  mfaResetSetup.classList.add("hidden");
  mfaResetPassword.value = "";
  mfaResetCode.value = "";
  mfaResetSecret.value = "";
  mfaResetUri.value = "";
  setMfaResetPasswordMessage("");
  setMfaResetConfirmMessage("");
  if (!mfaResetDialog.open) {
    mfaResetDialog.showModal();
  }
  mfaResetPassword.focus();
}

function closeMfaResetDialog(): void {
  if (mfaResetDialog.open) {
    mfaResetDialog.close();
  }
}

async function handleMfaResetStart(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setMfaResetPasswordMessage("");

  try {
    const result = await apiSend<{ mfaSetup: { secret: string; setupUri: string } }>(
      "/api/security/mfa/start-reset",
      "POST",
      { password: mfaResetPassword.value }
    );
    mfaResetPasswordForm.classList.add("hidden");
    mfaResetSetup.classList.remove("hidden");
    mfaResetSecret.value = result.mfaSetup.secret;
    mfaResetUri.value = result.mfaSetup.setupUri;
    mfaResetCode.focus();
  } catch (error) {
    setMfaResetPasswordMessage(error instanceof Error ? error.message : "Password was not accepted.", true);
  }
}

async function handleMfaResetConfirm(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setMfaResetConfirmMessage("");

  try {
    const result = await apiSend<{ backupCodes: string[]; user: CurrentUser }>(
      "/api/security/mfa/confirm-reset",
      "POST",
      { code: mfaResetCode.value.trim() }
    );
    state.user = result.user;
    downloadBackupCodes(result.backupCodes);
    closeMfaResetDialog();
    setSecurityMessage("Authenticator updated and new backup codes downloaded.");
  } catch (error) {
    setMfaResetConfirmMessage(error instanceof Error ? error.message : "Authenticator code failed.", true);
  }
}

async function handleShareInvite(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setShareMessage("");

  try {
    const shares = await apiSend<ShareState>("/api/shares/invite", "POST", {
      categoryId: Number(shareCalendar.value),
      email: shareEmail.value.trim()
    });
    state.shares = shares;
    shareEmail.value = "";
    renderShares();
    setShareMessage("Invitation added.");
  } catch (error) {
    setShareMessage(error instanceof Error ? error.message : "Could not send invitation.", true);
  }
}

async function handleSharedCalendarCreate(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setSharedCalendarMessage("");

  try {
    const result = await apiSend<{ category: Category; shares: ShareState }>("/api/calendars/shared", "POST", {
      name: sharedCalendarName.value.trim(),
      color: sharedCalendarColor.value,
      email: sharedCalendarEmail.value.trim()
    });
    state.shares = result.shares;
    await refreshCategories();
    renderShares();
    sharedCalendarForm.reset();
    sharedCalendarColor.value = "#2563eb";
    setSharedCalendarMessage("Shared calendar created.");
  } catch (error) {
    setSharedCalendarMessage(error instanceof Error ? error.message : "Could not create calendar.", true);
  }
}

async function saveAdminUser(userId: number, formElement: HTMLFormElement): Promise<void> {
  const message = formElement.querySelector("[data-admin-user-message]") as HTMLParagraphElement;
  setInlineMessage(message, "");
  const formData = new FormData(formElement);

  try {
    const summary = await apiSend<AdminSummary>(`/api/admin/users/${userId}`, "PUT", {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      dateOfBirth: String(formData.get("dateOfBirth") ?? "")
    });
    state.adminSummary = summary;
    renderAdminSummary();
  } catch (error) {
    setInlineMessage(message, error instanceof Error ? error.message : "Could not save user.", true);
  }
}

async function resetAdminUserPassword(userId: number, formElement: HTMLFormElement): Promise<void> {
  const message = formElement.querySelector("[data-admin-password-message]") as HTMLParagraphElement;
  const passwordInput = formElement.querySelector("input[name='password']") as HTMLInputElement;
  setInlineMessage(message, "");

  try {
    const summary = await apiSend<AdminSummary>(`/api/admin/users/${userId}/reset-password`, "POST", {
      password: passwordInput.value
    });
    state.adminSummary = summary;
    passwordInput.value = "";
    renderAdminSummary();
  } catch (error) {
    setInlineMessage(message, error instanceof Error ? error.message : "Could not reset password.", true);
  }
}

async function requireAdminUserMfaReset(userId: number): Promise<void> {
  try {
    const summary = await apiSend<AdminSummary>(`/api/admin/users/${userId}/require-mfa-reset`, "POST");
    state.adminSummary = summary;
    renderAdminSummary();
  } catch (error) {
    authMessage.textContent = error instanceof Error ? error.message : "Could not require MFA reset.";
    authMessage.classList.add("error");
  }
}

async function respondToInvitation(shareId: number, action: string): Promise<void> {
  try {
    const shares = await apiSend<ShareState>("/api/shares/respond", "POST", { shareId, action });
    state.shares = shares;
    await refreshCategories();
    await refreshEvents();
    renderShares();
  } catch (error) {
    setShareMessage(error instanceof Error ? error.message : "Could not update invitation.", true);
  }
}

async function revokeShare(shareId: number): Promise<void> {
  try {
    const shares = await apiSend<ShareState>("/api/shares/revoke", "POST", { shareId });
    state.shares = shares;
    await refreshCategories();
    await refreshEvents();
    renderShares();
  } catch (error) {
    setShareMessage(error instanceof Error ? error.message : "Could not revoke share.", true);
  }
}

function getPayload(): EventPayload {
  return {
    title: titleInput.value.trim(),
    eventDate: dateInput.value,
    recurrence: recurrenceTypeInput.value as Recurrence,
    recurrenceInterval: recurrenceTypeInput.value === "none"
      ? 1
      : Math.max(1, Number(recurrenceIntervalInput.value) || 1),
    categoryName: categoryInput.value.trim(),
    categoryColor: categoryColor.disabled ? "" : categoryColor.value,
    notes: notesInput.value.trim(),
    detailsEnabled: detailsEnabledInput.checked,
    detailStartDate: detailStartDateInput.value
  };
}

function startEditing(event: CalendarEvent): void {
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

function resetForm(clearMessage = true): void {
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

function syncEventDetailsFields(): void {
  eventDetailsFields.classList.toggle("hidden", !detailsEnabledInput.checked);
}

function syncRecurrenceFields(): void {
  const recurrence = recurrenceTypeInput.value as Recurrence;
  const isRecurring = recurrence !== "none";
  recurrenceIntervalRow.classList.toggle("hidden", !isRecurring);

  const units: Record<Exclude<Recurrence, "none">, string> = {
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
  return state.categories.find((category) => category.canAddEvents && category.name.toLowerCase() === name.toLowerCase());
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

function startOfWeek(date: Date): Date {
  return addDaysLocal(date, -date.getDay());
}

function endOfWeek(date: Date): Date {
  return addDaysLocal(startOfWeek(date), 6);
}

function addDaysLocal(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return new Date(next.getFullYear(), next.getMonth(), next.getDate());
}

function datesBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor = addDaysLocal(cursor, 1);
  }

  return days;
}

function sameDate(first: Date, second: Date): boolean {
  return toDateOnly(first) === toDateOnly(second);
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

function formatDetailDate(dateString: string): string {
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

function monthName(month: number): string {
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
  if (source === "american") {
    return "American";
  }
  return "Manual";
}

function categoryLabel(category: Category): string {
  if (category.sharedWithMe && category.ownerDisplayName) {
    return `${category.name} (${category.ownerDisplayName})`;
  }
  return category.name;
}

function eventCategoryLabel(event: CalendarEvent): string {
  if (
    event.categoryOwnerUserId
    && state.user
    && event.categoryOwnerUserId !== state.user.id
    && event.categoryOwnerDisplayName
  ) {
    return `${event.categoryName} (${event.categoryOwnerDisplayName})`;
  }
  return event.categoryName;
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
    if (response.status === 401) {
      showAuth();
    }
    throw new Error(data?.error ?? `Request failed with ${response.status}`);
  }

  return data as T;
}

function setAuthMessage(message: string, isError = false): void {
  authMessage.textContent = message;
  authMessage.classList.toggle("error", isError);
}

function setLoginMessage(message: string, isError = false): void {
  loginMessage.textContent = message;
  loginMessage.classList.toggle("error", isError);
}

function setLoginMfaMessage(message: string, isError = false): void {
  loginMfaMessage.textContent = message;
  loginMfaMessage.classList.toggle("error", isError);
}

function setSignupMessage(message: string, isError = false): void {
  signupMessage.textContent = message;
  signupMessage.classList.toggle("error", isError);
}

function setMfaMessage(message: string, isError = false): void {
  mfaMessage.textContent = message;
  mfaMessage.classList.toggle("error", isError);
}

function setMessage(message: string, isError = false): void {
  formMessage.textContent = message;
  formMessage.classList.toggle("error", isError);
}

function setImportMessage(message: string, isError = false): void {
  importMessage.textContent = message;
  importMessage.classList.toggle("error", isError);
}

function setShareMessage(message: string, isError = false): void {
  shareMessage.textContent = message;
  shareMessage.classList.toggle("error", isError);
}

function setSharedCalendarMessage(message: string, isError = false): void {
  sharedCalendarMessage.textContent = message;
  sharedCalendarMessage.classList.toggle("error", isError);
}

function setSecurityMessage(message: string, isError = false): void {
  securityMessage.textContent = message;
  securityMessage.classList.toggle("error", isError);
}

function setMfaResetPasswordMessage(message: string, isError = false): void {
  mfaResetPasswordMessage.textContent = message;
  mfaResetPasswordMessage.classList.toggle("error", isError);
}

function setMfaResetConfirmMessage(message: string, isError = false): void {
  mfaResetConfirmMessage.textContent = message;
  mfaResetConfirmMessage.classList.toggle("error", isError);
}

function setInlineMessage(element: HTMLParagraphElement, message: string, isError = false): void {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function downloadBackupCodes(codes: string[]): void {
  if (!codes.length) {
    return;
  }

  const body = [
    "Countdown Calendar backup codes",
    "Each code can be used once in place of an authenticator code.",
    "",
    ...codes
  ].join("\n");
  const blob = new Blob([`${body}\n`], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "countdown-calendar-backup-codes.txt";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
