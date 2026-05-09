import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { DatabaseSync } from "node:sqlite";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync
} from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type CategoryRow = {
  id: number;
  name: string;
  color: string;
  builtin: number;
  created_at: string;
  updated_at: string;
};

type Recurrence = "none" | "daily" | "weekly" | "monthly" | "annual";

type EventRow = {
  id: number;
  title: string;
  event_date: string;
  category_id: number;
  recurrence: Recurrence;
  recurrence_interval: number;
  source: "manual" | "federal" | "christian";
  notes: string;
  details_enabled: number;
  detail_start_date: string;
  created_at: string;
  updated_at: string;
  category_name: string;
  category_color: string;
  category_builtin: number;
};

type UpcomingEvent = {
  id: number;
  title: string;
  eventDate: string;
  occurrenceDate: string;
  daysUntil: number;
  categoryId: number;
  categoryName: string;
  categoryColor: string;
  categoryBuiltin: boolean;
  recurrence: Recurrence;
  recurrenceInterval: number;
  recurrenceLabel: string;
  source: "manual" | "federal" | "christian";
  notes: string;
  detailsEnabled: boolean;
  detailSummary: string;
  detailStartDate: string;
  detailStartLabel: string;
};

type ImportFormat = "auto" | "ics" | "json" | "csv";

type ImportCandidate = {
  title: string;
  eventDate: string;
  recurrence: Recurrence;
  recurrenceInterval?: number;
  notes: string;
  detailsEnabled?: boolean;
  detailStartDate?: string;
  categoryName?: string;
  categoryColor?: string;
};

type AppSettings = {
  eventDetailsEnabled: boolean;
  darkModeEnabled: boolean;
};

type HolidayDetail = {
  summary: string;
  startDate: string;
  startLabel: string;
};

const serverDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(serverDir, "..");
const publicDir = resolve(rootDir, "public");
const defaultDataDir = resolve(rootDir, "data");
const configuredDbPath = process.env.DB_PATH ?? join(defaultDataDir, "calendar.db");
const dbPath = configuredDbPath === ":memory:" ? ":memory:" : resolve(configuredDbPath);

if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    color TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    recurrence TEXT NOT NULL CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly', 'annual')),
    recurrence_interval INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL CHECK (source IN ('manual', 'federal', 'christian')),
    notes TEXT NOT NULL DEFAULT '',
    details_enabled INTEGER NOT NULL DEFAULT 0,
    detail_start_date TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

`);

migrateSchema();
ensureDefaultSetting("eventDetailsEnabled", "true");
ensureDefaultSetting("darkModeEnabled", "false");
ensureEventIndexes();
seedBuiltIns();

function nowIso(): string {
  return new Date().toISOString();
}

function migrateSchema(): void {
  ensureColumn("events", "details_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("events", "detail_start_date", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("events", "recurrence_interval", "INTEGER NOT NULL DEFAULT 1");
  migrateEventsRecurrenceConstraint();
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function ensureDefaultSetting(key: string, value: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)"
  ).run(key, value, nowIso());
}

function ensureEventIndexes(): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
    CREATE INDEX IF NOT EXISTS idx_events_category_id ON events(category_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seeded_holiday_unique
      ON events(title, event_date, source)
      WHERE source IN ('federal', 'christian');
  `);
}

function migrateEventsRecurrenceConstraint(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'")
    .get() as { sql: string } | undefined;

  if (!row?.sql.includes("recurrence IN ('none', 'annual')")) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;

    CREATE TABLE events_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      recurrence TEXT NOT NULL CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly', 'annual')),
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL CHECK (source IN ('manual', 'federal', 'christian')),
      notes TEXT NOT NULL DEFAULT '',
      details_enabled INTEGER NOT NULL DEFAULT 0,
      detail_start_date TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
    );

    INSERT INTO events_new
      (id, title, event_date, category_id, recurrence, recurrence_interval, source, notes, details_enabled, detail_start_date, created_at, updated_at)
    SELECT
      id,
      title,
      event_date,
      category_id,
      recurrence,
      COALESCE(recurrence_interval, 1),
      source,
      COALESCE(notes, ''),
      COALESCE(details_enabled, 0),
      COALESCE(detail_start_date, ''),
      created_at,
      updated_at
    FROM events;

    DROP TABLE events;
    ALTER TABLE events_new RENAME TO events;

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function getSettings(): AppSettings {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Array<{
    key: string;
    value: string;
  }>;
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    eventDetailsEnabled: values.get("eventDetailsEnabled") !== "false",
    darkModeEnabled: values.get("darkModeEnabled") === "true"
  };
}

function updateSettings(body: unknown): AppSettings {
  if (!body || typeof body !== "object") {
    throw httpError(400, "Expected a JSON object.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.eventDetailsEnabled === "boolean") {
    updateBooleanSetting("eventDetailsEnabled", input.eventDetailsEnabled);
  }

  if (typeof input.darkModeEnabled === "boolean") {
    updateBooleanSetting("darkModeEnabled", input.darkModeEnabled);
  }

  return getSettings();
}

function updateBooleanSetting(key: keyof AppSettings, value: boolean): void {
  db.prepare(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `
  ).run(key, String(value), nowIso());
}

function ensureCategory(name: string, color: string, builtin: boolean): number {
  const existing = db
    .prepare("SELECT id, color, builtin FROM categories WHERE name = ?")
    .get(name) as { id: number; color: string; builtin: number } | undefined;

  if (existing) {
    if (builtin && (existing.color !== color || existing.builtin !== 1)) {
      db.prepare("UPDATE categories SET color = ?, builtin = 1, updated_at = ? WHERE id = ?")
        .run(color, nowIso(), existing.id);
    }
    return existing.id;
  }

  const result = db
    .prepare(
      "INSERT INTO categories (name, color, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(name, color, builtin ? 1 : 0, nowIso(), nowIso());

  return Number(result.lastInsertRowid);
}

function seedBuiltIns(): void {
  const federalCategoryId = ensureCategory("Federal Holidays", "#f97316", true);
  const christianCategoryId = ensureCategory("Christian Holidays", "#facc15", true);
  ensureCategory("Birthday", "#14b8a6", true);
  ensureCategory("Anniversaries", "#4338ca", true);
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 1;
  const endYear = currentYear + 10;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO events
      (title, event_date, category_id, recurrence, source, notes, created_at, updated_at)
    VALUES (?, ?, ?, 'none', ?, '', ?, ?)
  `);

  for (let year = startYear; year <= endYear; year += 1) {
    for (const holiday of federalHolidays(year)) {
      insert.run(holiday.title, holiday.date, federalCategoryId, "federal", nowIso(), nowIso());
    }

    for (const holiday of christianHolidays(year)) {
      insert.run(holiday.title, holiday.date, christianCategoryId, "christian", nowIso(), nowIso());
    }
  }
}

function federalHolidays(year: number): Array<{ title: string; date: string }> {
  return [
    observedFixedHoliday("New Year's Day", year, 1, 1),
    {
      title: "Martin Luther King Jr. Day",
      date: formatDate(nthWeekdayOfMonth(year, 1, 1, 3))
    },
    {
      title: "Washington's Birthday",
      date: formatDate(nthWeekdayOfMonth(year, 2, 1, 3))
    },
    {
      title: "Memorial Day",
      date: formatDate(lastWeekdayOfMonth(year, 5, 1))
    },
    observedFixedHoliday("Juneteenth National Independence Day", year, 6, 19),
    observedFixedHoliday("Independence Day", year, 7, 4),
    {
      title: "Labor Day",
      date: formatDate(nthWeekdayOfMonth(year, 9, 1, 1))
    },
    {
      title: "Columbus Day",
      date: formatDate(nthWeekdayOfMonth(year, 10, 1, 2))
    },
    observedFixedHoliday("Veterans Day", year, 11, 11),
    {
      title: "Thanksgiving Day",
      date: formatDate(nthWeekdayOfMonth(year, 11, 4, 4))
    },
    observedFixedHoliday("Christmas Day", year, 12, 25)
  ];
}

function christianHolidays(year: number): Array<{ title: string; date: string }> {
  const easter = easterSunday(year);

  return [
    { title: "Epiphany", date: formatDate(utcDate(year, 1, 6)) },
    { title: "Ash Wednesday", date: formatDate(addDays(easter, -46)) },
    { title: "Palm Sunday", date: formatDate(addDays(easter, -7)) },
    { title: "Maundy Thursday", date: formatDate(addDays(easter, -3)) },
    { title: "Good Friday", date: formatDate(addDays(easter, -2)) },
    { title: "Easter Sunday", date: formatDate(easter) },
    { title: "Easter Monday", date: formatDate(addDays(easter, 1)) },
    { title: "Ascension Day", date: formatDate(addDays(easter, 39)) },
    { title: "Pentecost", date: formatDate(addDays(easter, 49)) },
    { title: "Trinity Sunday", date: formatDate(addDays(easter, 56)) },
    { title: "All Saints' Day", date: formatDate(utcDate(year, 11, 1)) },
    { title: "Advent Begins", date: formatDate(firstSundayOfAdvent(year)) },
    { title: "Christmas Day", date: formatDate(utcDate(year, 12, 25)) }
  ];
}

function observedFixedHoliday(title: string, year: number, month: number, day: number) {
  const actual = utcDate(year, month, day);
  const observed = new Date(actual);
  const weekday = actual.getUTCDay();

  if (weekday === 6) {
    observed.setUTCDate(observed.getUTCDate() - 1);
  } else if (weekday === 0) {
    observed.setUTCDate(observed.getUTCDate() + 1);
  }

  const actualDate = formatDate(actual);
  const observedDate = formatDate(observed);
  return {
    title: actualDate === observedDate ? title : `${title} (Observed)`,
    date: observedDate
  };
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return utcDate(year, month, day);
}

function firstSundayOfAdvent(year: number): Date {
  const start = utcDate(year, 11, 27);
  const offset = (7 - start.getUTCDay()) % 7;
  return addDays(start, offset);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(year, month, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = utcDate(year, month + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return addDays(last, -offset);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateOnly(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return utcDate(year, month, day);
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDateOnly(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  return Math.round((end - start) / 86_400_000);
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  return formatDate(parseDateOnly(value)) === value;
}

function nextOccurrence(eventDate: string, recurrence: Recurrence, interval: number, today: string): string {
  if (recurrence === "none") {
    return eventDate;
  }

  if (eventDate >= today) {
    return eventDate;
  }

  const normalizedInterval = normalizeRecurrenceInterval(interval);

  if (recurrence === "daily") {
    return nextDayIntervalOccurrence(eventDate, today, normalizedInterval);
  }

  if (recurrence === "weekly") {
    return nextDayIntervalOccurrence(eventDate, today, normalizedInterval * 7);
  }

  if (recurrence === "monthly") {
    return nextMonthIntervalOccurrence(eventDate, today, normalizedInterval);
  }

  return nextMonthIntervalOccurrence(eventDate, today, normalizedInterval * 12);
}

function nextDayIntervalOccurrence(eventDate: string, today: string, dayStep: number): string {
  const elapsedDays = daysBetween(eventDate, today);
  const cycles = Math.ceil(elapsedDays / dayStep);
  return formatDate(addDays(parseDateOnly(eventDate), cycles * dayStep));
}

function nextMonthIntervalOccurrence(eventDate: string, today: string, monthStep: number): string {
  const [sourceYear, sourceMonth] = eventDate.split("-").map(Number);
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const elapsedMonths = Math.max(0, (todayYear - sourceYear) * 12 + (todayMonth - sourceMonth));
  let cycles = Math.floor(elapsedMonths / monthStep);
  let occurrence = formatDate(addMonthsClamped(parseDateOnly(eventDate), cycles * monthStep));

  if (occurrence < today) {
    cycles += 1;
    occurrence = formatDate(addMonthsClamped(parseDateOnly(eventDate), cycles * monthStep));
  }

  return occurrence;
}

function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month, 1));
  const maxDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, maxDay));
  return target;
}

function normalizeRecurrenceInterval(value: number): number {
  return clampNumber(value, 1, 999);
}

function recurrenceLabel(recurrence: Recurrence, interval: number): string {
  const normalizedInterval = normalizeRecurrenceInterval(interval);

  if (recurrence === "none") {
    return "Once";
  }

  const units: Record<Exclude<Recurrence, "none">, string> = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    annual: "year"
  };
  const unit = units[recurrence];
  return normalizedInterval === 1
    ? `Every ${unit}`
    : `Every ${normalizedInterval} ${unit}s`;
}

function getUpcomingEvents(daysAhead: number): UpcomingEvent[] {
  const today = todayDateOnly();
  const rows = db
    .prepare(
      `
      SELECT
        e.*,
        c.name AS category_name,
        c.color AS category_color,
        c.builtin AS category_builtin
      FROM events e
      JOIN categories c ON c.id = e.category_id
      ORDER BY e.event_date ASC, e.title ASC
    `
    )
    .all() as EventRow[];

  return rows
    .map((event) => {
      const recurrenceInterval = normalizeRecurrenceInterval(event.recurrence_interval);
      const occurrenceDate = nextOccurrence(event.event_date, event.recurrence, recurrenceInterval, today);
      const daysUntil = daysBetween(today, occurrenceDate);
      const details = detailsForEvent(event);

      return {
        id: event.id,
        title: event.title,
        eventDate: event.event_date,
        occurrenceDate,
        daysUntil,
        categoryId: event.category_id,
        categoryName: event.category_name,
        categoryColor: event.category_color,
        categoryBuiltin: event.category_builtin === 1,
        recurrence: event.recurrence,
        recurrenceInterval,
        recurrenceLabel: recurrenceLabel(event.recurrence, recurrenceInterval),
        source: event.source,
        notes: event.notes,
        detailsEnabled: event.details_enabled === 1 || event.source !== "manual",
        detailSummary: details.summary,
        detailStartDate: details.startDate,
        detailStartLabel: details.startLabel,
      };
    })
    .filter((event) => event.daysUntil >= 0 && event.daysUntil <= daysAhead)
    .sort((a, b) => {
      if (a.daysUntil !== b.daysUntil) {
        return a.daysUntil - b.daysUntil;
      }
      return a.title.localeCompare(b.title);
    });
}

function detailsForEvent(event: EventRow): HolidayDetail {
  if (event.source === "manual") {
    return {
      summary: event.details_enabled === 1 ? event.notes : "",
      startDate: event.details_enabled === 1 ? event.detail_start_date : "",
      startLabel: "Start date"
    };
  }

  const key = normalizeHolidayTitle(event.title);
  const detail = event.source === "federal"
    ? FEDERAL_HOLIDAY_DETAILS[key]
    : CHRISTIAN_HOLIDAY_DETAILS[key];

  return detail ?? {
    summary: "",
    startDate: "",
    startLabel: event.source === "federal" ? "Federal holiday since" : "Observed since"
  };
}

function normalizeHolidayTitle(title: string): string {
  return title.replace(/\s+\(Observed\)$/i, "").trim();
}

const FEDERAL_HOLIDAY_DETAILS: Record<string, HolidayDetail> = {
  "New Year's Day": {
    summary: "Marks the first day of the Gregorian calendar year.",
    startDate: "1870-06-28",
    startLabel: "Federal holiday since"
  },
  "Martin Luther King Jr. Day": {
    summary: "Honors Martin Luther King Jr. and his leadership in the American civil rights movement.",
    startDate: "1983-11-02",
    startLabel: "Federal holiday signed"
  },
  "Washington's Birthday": {
    summary: "Honors George Washington, the first U.S. president; many states and calendars also treat the day as Presidents' Day.",
    startDate: "1879-01-31",
    startLabel: "Federal holiday signed"
  },
  "Memorial Day": {
    summary: "Honors U.S. military personnel who died while serving. It grew from Decoration Day after the Civil War.",
    startDate: "1888-08-01",
    startLabel: "Federal holiday added"
  },
  "Juneteenth National Independence Day": {
    summary: "Commemorates June 19, 1865, when enslaved people in Galveston, Texas, were informed of emancipation.",
    startDate: "2021-06-17",
    startLabel: "Federal holiday signed"
  },
  "Independence Day": {
    summary: "Commemorates the adoption of the Declaration of Independence on July 4, 1776.",
    startDate: "1870-06-28",
    startLabel: "Federal holiday since"
  },
  "Labor Day": {
    summary: "Honors workers and the labor movement's contributions to the United States.",
    startDate: "1894-06-28",
    startLabel: "Federal holiday signed"
  },
  "Columbus Day": {
    summary: "Recognizes Christopher Columbus's 1492 landing in the Americas; some communities observe Indigenous Peoples' Day instead or alongside it.",
    startDate: "1968-06-28",
    startLabel: "Federal holiday signed"
  },
  "Veterans Day": {
    summary: "Honors all U.S. military veterans. It began as Armistice Day, marking the end of World War I.",
    startDate: "1938-05-13",
    startLabel: "Federal holiday signed"
  },
  "Thanksgiving Day": {
    summary: "A day of gratitude associated with harvest celebrations and national thanksgiving proclamations.",
    startDate: "1870-06-28",
    startLabel: "Federal holiday since"
  },
  "Christmas Day": {
    summary: "Federal observance of Christmas, a Christian celebration of the birth of Jesus Christ.",
    startDate: "1870-06-28",
    startLabel: "Federal holiday since"
  }
};

const CHRISTIAN_HOLIDAY_DETAILS: Record<string, HolidayDetail> = {
  "Epiphany": {
    summary: "Celebrates the manifestation of Christ, often associated in Western Christianity with the visit of the Magi.",
    startDate: "0300-01-01",
    startLabel: "Observed since"
  },
  "Ash Wednesday": {
    summary: "Begins Lent, a season of penitence and preparation before Easter.",
    startDate: "0600-01-01",
    startLabel: "Developed by"
  },
  "Palm Sunday": {
    summary: "Recalls Jesus' entry into Jerusalem before his Passion.",
    startDate: "0300-01-01",
    startLabel: "Observed since"
  },
  "Maundy Thursday": {
    summary: "Commemorates the Last Supper and Jesus' commandment to love one another.",
    startDate: "0300-01-01",
    startLabel: "Observed since"
  },
  "Good Friday": {
    summary: "Commemorates the crucifixion of Jesus Christ.",
    startDate: "0300-01-01",
    startLabel: "Observed since"
  },
  "Easter Sunday": {
    summary: "Celebrates the resurrection of Jesus Christ and is the central feast of the Christian year.",
    startDate: "0100-01-01",
    startLabel: "Observed since"
  },
  "Easter Monday": {
    summary: "Continues the celebration of Easter in many Christian traditions.",
    startDate: "0300-01-01",
    startLabel: "Observed since"
  },
  "Ascension Day": {
    summary: "Commemorates Jesus' ascension into heaven, traditionally forty days after Easter.",
    startDate: "0300-01-01",
    startLabel: "Observed since"
  },
  "Pentecost": {
    summary: "Celebrates the coming of the Holy Spirit to the apostles and is often called the birthday of the Church.",
    startDate: "0100-01-01",
    startLabel: "Observed since"
  },
  "Trinity Sunday": {
    summary: "Celebrates the Christian doctrine of the Trinity: Father, Son, and Holy Spirit.",
    startDate: "1334-01-01",
    startLabel: "Western feast established"
  },
  "All Saints' Day": {
    summary: "Honors all saints, known and unknown, in the Christian tradition.",
    startDate: "0835-01-01",
    startLabel: "Western date fixed"
  },
  "Advent Begins": {
    summary: "Begins Advent, the season of preparation for Christmas and expectation of Christ's coming.",
    startDate: "0500-01-01",
    startLabel: "Season developed by"
  },
  "Christmas Day": {
    summary: "Celebrates the birth of Jesus Christ.",
    startDate: "0336-12-25",
    startLabel: "Date attested"
  }
};

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      today: todayDateOnly(),
      dbPath
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/categories") {
    const categories = db
      .prepare("SELECT * FROM categories ORDER BY builtin DESC, name ASC")
      .all() as CategoryRow[];
    sendJson(res, 200, { categories: categories.map(formatCategory) });
    return;
  }

  if (method === "GET" && url.pathname === "/api/events") {
    const days = clampNumber(Number(url.searchParams.get("days") ?? 730), 30, 3650);
    sendJson(res, 200, { events: getUpcomingEvents(days) });
    return;
  }

  if (method === "GET" && url.pathname === "/api/settings") {
    sendJson(res, 200, { settings: getSettings() });
    return;
  }

  if (method === "PUT" && url.pathname === "/api/settings") {
    const body = await readJson(req);
    sendJson(res, 200, { settings: updateSettings(body) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/events") {
    const body = await readJson(req);
    const created = createManualEvent(body);
    sendJson(res, 201, { event: created });
    return;
  }

  if (method === "POST" && url.pathname === "/api/import") {
    const body = await readJson(req, 5_000_000);
    const result = importManualEvents(body);
    sendJson(res, 200, result);
    return;
  }

  const eventMatch = url.pathname.match(/^\/api\/events\/(\d+)$/);
  if (eventMatch && method === "PUT") {
    const body = await readJson(req);
    const updated = updateManualEvent(Number(eventMatch[1]), body);
    sendJson(res, 200, { event: updated });
    return;
  }

  if (eventMatch && method === "DELETE") {
    deleteManualEvent(Number(eventMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/export") {
    const categories = db.prepare("SELECT * FROM categories ORDER BY name ASC").all();
    const events = db.prepare("SELECT * FROM events ORDER BY event_date ASC, title ASC").all();

    sendJson(
      res,
      200,
      {
        exportedAt: nowIso(),
        schemaVersion: 2,
        categories,
        events
      },
      {
        "Content-Disposition": `attachment; filename="countdown-calendar-export.json"`
      }
    );
    return;
  }

  if (method === "GET" && url.pathname === "/api/export.db") {
    sendDatabaseBackup(res);
    return;
  }

  if (method === "GET" && url.pathname === "/api/import-template.csv") {
    sendCsvTemplate(res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function formatCategory(category: CategoryRow) {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    builtin: category.builtin === 1
  };
}

function createManualEvent(body: unknown): UpcomingEvent {
  const input = validateEventInput(body);
  const categoryId = resolveCategory(input);
  const result = db
    .prepare(
      `
      INSERT INTO events
        (title, event_date, category_id, recurrence, recurrence_interval, source, notes, details_enabled, detail_start_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.title,
      input.eventDate,
      categoryId,
      input.recurrence,
      input.recurrenceInterval,
      input.notes,
      input.detailsEnabled ? 1 : 0,
      input.detailStartDate,
      nowIso(),
      nowIso()
    );

  const event = getUpcomingEvents(3650).find((item) => item.id === Number(result.lastInsertRowid));
  if (!event) {
    throw httpError(500, "Event was saved but could not be loaded.");
  }
  return event;
}

function updateManualEvent(id: number, body: unknown): UpcomingEvent {
  const existing = db.prepare("SELECT source FROM events WHERE id = ?").get(id) as
    | { source: string }
    | undefined;

  if (!existing) {
    throw httpError(404, "Event not found.");
  }

  if (existing.source !== "manual") {
    throw httpError(403, "Built-in holidays cannot be edited.");
  }

  const input = validateEventInput(body);
  const categoryId = resolveCategory(input);

  db.prepare(
    `
    UPDATE events
    SET title = ?, event_date = ?, category_id = ?, recurrence = ?, recurrence_interval = ?, notes = ?, details_enabled = ?, detail_start_date = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(
    input.title,
    input.eventDate,
    categoryId,
    input.recurrence,
    input.recurrenceInterval,
    input.notes,
    input.detailsEnabled ? 1 : 0,
    input.detailStartDate,
    nowIso(),
    id
  );

  const event = getUpcomingEvents(3650).find((item) => item.id === id);
  if (!event) {
    throw httpError(500, "Event was updated but could not be loaded.");
  }
  return event;
}

function deleteManualEvent(id: number): void {
  const existing = db.prepare("SELECT source FROM events WHERE id = ?").get(id) as
    | { source: string }
    | undefined;

  if (!existing) {
    throw httpError(404, "Event not found.");
  }

  if (existing.source !== "manual") {
    throw httpError(403, "Built-in holidays cannot be deleted.");
  }

  db.prepare("DELETE FROM events WHERE id = ?").run(id);
}

function importManualEvents(body: unknown): { imported: number; skipped: number; errors: string[] } {
  if (!body || typeof body !== "object") {
    throw httpError(400, "Expected a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const content = cleanText(input.content, 5_000_000);
  const filename = cleanText(input.filename, 240, true);
  const categoryName = cleanText(input.categoryName, 80, true) || "Imported Events";
  const categoryColor = cleanText(input.categoryColor, 20, true) || "#2563eb";
  const requestedFormat = cleanText(input.format, 20, true) || "auto";

  if (!content) {
    throw httpError(400, "Import file is empty.");
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(categoryColor)) {
    throw httpError(400, "Import category color must be a hex color.");
  }

  const format = detectImportFormat(requestedFormat, filename, content);
  const candidates = parseImportContent(format, content);

  if (!candidates.length) {
    throw httpError(400, "No importable events were found.");
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const insert = db.prepare(`
    INSERT INTO events
      (title, event_date, category_id, recurrence, recurrence_interval, source, notes, details_enabled, detail_start_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)
  `);

  for (const [index, candidate] of candidates.entries()) {
    try {
      const title = candidate.title.trim().slice(0, 140);
      const eventDate = candidate.eventDate.trim().slice(0, 10);
      const recurrence = normalizeRecurrence(candidate.recurrence);
      const recurrenceInterval = normalizeRecurrenceInterval(candidate.recurrenceInterval ?? 1);
      const notes = candidate.notes.trim().slice(0, 500);
      const detailStartDate = candidate.detailStartDate?.trim().slice(0, 10) ?? "";
      const detailsEnabled = candidate.detailsEnabled ?? Boolean(notes || detailStartDate);
      const eventCategoryName = candidate.categoryName?.trim().slice(0, 80) || categoryName;
      const eventCategoryColor = candidate.categoryColor?.trim().slice(0, 20) || categoryColor;

      if (!title) {
        throw new Error("missing title");
      }

      if (!isValidDateOnly(eventDate)) {
        throw new Error("invalid date");
      }

      if (detailStartDate && !isValidDateOnly(detailStartDate)) {
        throw new Error("invalid detail start date");
      }

      if (!eventCategoryName) {
        throw new Error("missing category");
      }

      if (!/^#[0-9a-fA-F]{6}$/.test(eventCategoryColor)) {
        throw new Error("invalid category color");
      }

      const categoryId = resolveCategoryByName(eventCategoryName, eventCategoryColor);
      const duplicate = db
        .prepare(
          "SELECT id FROM events WHERE title = ? AND event_date = ? AND category_id = ? AND source = 'manual' LIMIT 1"
        )
        .get(title, eventDate, categoryId) as { id: number } | undefined;

      if (duplicate) {
        skipped += 1;
        continue;
      }

      insert.run(
        title,
        eventDate,
        categoryId,
        recurrence,
        recurrenceInterval,
        notes,
        detailsEnabled ? 1 : 0,
        detailStartDate,
        nowIso(),
        nowIso()
      );
      imported += 1;
    } catch (error) {
      skipped += 1;
      if (errors.length < 20) {
        const message = error instanceof Error ? error.message : "unknown error";
        errors.push(`Row ${index + 1}: ${message}`);
      }
    }
  }

  return { imported, skipped, errors };
}

function detectImportFormat(requestedFormat: string, filename: string, content: string): Exclude<ImportFormat, "auto"> {
  const format = requestedFormat.toLowerCase();
  if (format === "ics" || format === "json" || format === "csv") {
    return format;
  }

  const lowerFilename = filename.toLowerCase();
  const trimmed = content.trimStart();

  if (lowerFilename.endsWith(".ics") || trimmed.startsWith("BEGIN:VCALENDAR")) {
    return "ics";
  }

  if (lowerFilename.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }

  return "csv";
}

function parseImportContent(format: Exclude<ImportFormat, "auto">, content: string): ImportCandidate[] {
  if (format === "ics") {
    return parseIcs(content);
  }

  if (format === "json") {
    return parseJsonImport(content);
  }

  return parseCsvImport(content);
}

function parseIcs(content: string): ImportCandidate[] {
  const lines = unfoldIcsLines(content);
  const events: ImportCandidate[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    const normalized = line.trim().toUpperCase();

    if (normalized === "BEGIN:VEVENT") {
      current = [];
      continue;
    }

    if (normalized === "END:VEVENT") {
      if (current) {
        const event = parseIcsEvent(current);
        if (event) {
          events.push(event);
        }
      }
      current = null;
      continue;
    }

    if (current) {
      current.push(line);
    }
  }

  return events;
}

function unfoldIcsLines(content: string): string[] {
  const rawLines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function parseIcsEvent(lines: string[]): ImportCandidate | null {
  const props = new Map<string, string[]>();

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const name = line.slice(0, colonIndex).split(";")[0].toUpperCase();
    const value = unescapeIcsText(line.slice(colonIndex + 1));
    const existing = props.get(name) ?? [];
    existing.push(value);
    props.set(name, existing);
  }

  const title = firstProp(props, "SUMMARY") || "Imported event";
  const start = firstProp(props, "DTSTART");
  const eventDate = start ? parseIcsDate(start) : "";

  if (!eventDate) {
    return null;
  }

  const rrule = firstProp(props, "RRULE").toUpperCase();
  const categories = firstProp(props, "CATEGORIES");
  const recurrence = recurrenceFromRrule(rrule);

  return {
    title,
    eventDate,
    recurrence: recurrence.type,
    recurrenceInterval: recurrence.interval,
    notes: firstProp(props, "DESCRIPTION"),
    categoryName: categories ? categories.split(",")[0].trim() : undefined
  };
}

function firstProp(props: Map<string, string[]>, name: string): string {
  return props.get(name)?.[0]?.trim() ?? "";
}

function parseIcsDate(value: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function recurrenceFromRrule(rrule: string): { type: Recurrence; interval: number } {
  if (!rrule) {
    return { type: "none", interval: 1 };
  }

  const frequency = rrule.match(/(?:^|;)FREQ=([^;]+)/)?.[1] ?? "";
  const interval = normalizeRecurrenceInterval(Number(rrule.match(/(?:^|;)INTERVAL=(\d+)/)?.[1] ?? 1));

  if (frequency === "DAILY") {
    return { type: "daily", interval };
  }

  if (frequency === "WEEKLY") {
    return { type: "weekly", interval };
  }

  if (frequency === "MONTHLY") {
    return { type: "monthly", interval };
  }

  if (frequency === "YEARLY") {
    return { type: "annual", interval };
  }

  return { type: "none", interval: 1 };
}

function unescapeIcsText(value: string): string {
  return value
    .replaceAll("\\n", " ")
    .replaceAll("\\N", " ")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\")
    .trim();
}

function parseJsonImport(content: string): ImportCandidate[] {
  let data: unknown;

  try {
    data = JSON.parse(content) as unknown;
  } catch {
    throw httpError(400, "Invalid JSON import file.");
  }

  const categories = new Map<number, { name: string; color: string }>();

  if (isRecord(data) && Array.isArray(data.categories)) {
    for (const category of data.categories) {
      if (!isRecord(category)) {
        continue;
      }

      const id = Number(category.id);
      const name = textFromUnknown(category.name);
      const color = textFromUnknown(category.color);

      if (Number.isFinite(id) && name) {
        categories.set(id, { name, color });
      }
    }
  }

  const rawEvents = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.events)
      ? data.events
      : [];

  return rawEvents
    .filter(isRecord)
    .filter((event) => {
      const source = textFromUnknown(event.source);
      return !source || source === "manual";
    })
    .map((event) => {
      const categoryId = Number(event.categoryId ?? event.category_id);
      const category = categories.get(categoryId);

      return {
        title: textFromUnknown(event.title ?? event.summary ?? event.subject),
        eventDate: textFromUnknown(event.eventDate ?? event.event_date ?? event.date ?? event.start),
        recurrence: normalizeRecurrence(textFromUnknown(event.recurrence)),
        recurrenceInterval: recurrenceIntervalFromUnknown(
          event.recurrenceInterval ?? event.recurrence_interval ?? event.interval
        ),
        notes: textFromUnknown(event.notes ?? event.description),
        detailsEnabled: parseOptionalBoolean(event.detailsEnabled ?? event.details_enabled),
        detailStartDate: textFromUnknown(
          event.detailStartDate ?? event.detail_start_date ?? event.startDate ?? event.start_date
        ),
        categoryName: textFromUnknown(event.categoryName ?? event.category_name) || category?.name,
        categoryColor: textFromUnknown(event.categoryColor ?? event.category_color) || category?.color
      };
    });
}

function parseCsvImport(content: string): ImportCandidate[] {
  const rows = parseCsvRows(content);
  if (!rows.length) {
    return [];
  }

  const firstRow = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = firstRow.some((cell) =>
    ["title", "subject", "summary", "date", "eventdate", "event_date", "start", "dtstart"].includes(cell)
  );
  const header = hasHeader ? firstRow : ["title", "date", "category", "recurrence", "notes", "color"];
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      const values = new Map<string, string>();
      header.forEach((name, index) => {
        values.set(name, row[index]?.trim() ?? "");
      });

      return {
        title: getCsvValue(values, ["title", "subject", "summary"]),
        eventDate: getCsvValue(values, ["date", "eventdate", "event_date", "start", "dtstart"]),
        recurrence: normalizeRecurrence(getCsvValue(values, ["recurrence", "repeats"])),
        recurrenceInterval: recurrenceIntervalFromUnknown(
          getCsvValue(values, ["recurrence_interval", "recurrenceinterval", "interval", "every"])
        ),
        notes: getCsvValue(values, ["notes", "description"]),
        detailsEnabled: parseOptionalBoolean(getCsvValue(values, ["details_enabled", "detailsenabled", "show_details"])),
        detailStartDate: getCsvValue(values, ["detail_start_date", "detailstartdate", "start_date", "startdate"]),
        categoryName: getCsvValue(values, ["category", "categoryname", "category_name"]),
        categoryColor: getCsvValue(values, ["color", "categorycolor", "category_color"])
      };
    });
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function getCsvValue(values: Map<string, string>, names: string[]): string {
  for (const name of names) {
    const value = values.get(name);
    if (value) {
      return value.trim();
    }
  }

  return "";
}

function resolveCategoryByName(name: string, color: string): number {
  const existing = db
    .prepare("SELECT id FROM categories WHERE name = ?")
    .get(name) as { id: number } | undefined;

  if (existing) {
    return existing.id;
  }

  return ensureCategory(name, color, false);
}

function textFromUnknown(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function parseBoolean(value: unknown): boolean {
  return parseOptionalBoolean(value) ?? false;
}

function normalizeRecurrence(value: unknown): Recurrence {
  const text = textFromUnknown(value).toLowerCase();
  if (text === "daily" || text === "day") {
    return "daily";
  }

  if (text === "weekly" || text === "week") {
    return "weekly";
  }

  if (text === "monthly" || text === "month") {
    return "monthly";
  }

  if (text === "annual" || text === "yearly" || text === "year") {
    return "annual";
  }

  return "none";
}

function recurrenceIntervalFromUnknown(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const interval = Number(value);
  return normalizeRecurrenceInterval(interval);
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  const text = textFromUnknown(value).toLowerCase();
  if (!text) {
    return undefined;
  }

  if (["1", "true", "yes", "y", "on"].includes(text)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(text)) {
    return false;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEventInput(body: unknown) {
  if (!body || typeof body !== "object") {
    throw httpError(400, "Expected a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const title = cleanText(input.title, 140);
  const eventDate = cleanText(input.eventDate, 10);
  const recurrence = normalizeRecurrence(input.recurrence);
  const recurrenceInterval = recurrence === "none"
    ? 1
    : recurrenceIntervalFromUnknown(input.recurrenceInterval) ?? 1;
  const notes = cleanText(input.notes, 500, true);
  const detailsEnabled = parseBoolean(input.detailsEnabled);
  const detailStartDate = cleanText(input.detailStartDate, 10, true);
  const categoryId = Number(input.categoryId ?? 0);
  const categoryName = cleanText(input.categoryName, 80, true);
  const categoryColor = cleanText(input.categoryColor, 20, true);

  if (!title) {
    throw httpError(400, "Title is required.");
  }

  if (!isValidDateOnly(eventDate)) {
    throw httpError(400, "Date must be in YYYY-MM-DD format.");
  }

  if (!categoryId && !categoryName) {
    throw httpError(400, "Choose a category or enter a new one.");
  }

  if (categoryName && categoryName.length < 2) {
    throw httpError(400, "Category names need at least two characters.");
  }

  if (categoryName && categoryColor && !/^#[0-9a-fA-F]{6}$/.test(categoryColor)) {
    throw httpError(400, "Category color must be a hex color.");
  }

  if (detailStartDate && !isValidDateOnly(detailStartDate)) {
    throw httpError(400, "Detail start date must be in YYYY-MM-DD format.");
  }

  return {
    title,
    eventDate,
    recurrence,
    recurrenceInterval,
    notes,
    detailsEnabled,
    detailStartDate,
    categoryId,
    categoryName,
    categoryColor
  };
}

function resolveCategory(input: ReturnType<typeof validateEventInput>): number {
  if (input.categoryName) {
    const existing = db
      .prepare("SELECT id FROM categories WHERE name = ?")
      .get(input.categoryName) as { id: number } | undefined;

    if (existing) {
      return existing.id;
    }

    if (!input.categoryColor) {
      throw httpError(400, "Pick a color for the new category.");
    }

    return ensureCategory(input.categoryName, input.categoryColor, false);
  }

  const existing = db
    .prepare("SELECT id FROM categories WHERE id = ?")
    .get(input.categoryId) as { id: number } | undefined;

  if (!existing) {
    throw httpError(400, "Category does not exist.");
  }

  return existing.id;
}

function cleanText(value: unknown, maxLength: number, optional = false): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    if (optional) {
      return "";
    }
    throw httpError(400, "Expected a text value.");
  }

  return value.trim().slice(0, maxLength);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function sendDatabaseBackup(res: ServerResponse): void {
  const backupDir = resolve(dirname(dbPath), "backups");
  mkdirSync(backupDir, { recursive: true });

  const timestamp = nowIso().replace(/[:.]/g, "-");
  const backupPath = resolve(backupDir, `calendar-${timestamp}.db`);
  const sqlPath = backupPath.replace(/'/g, "''");

  db.exec(`VACUUM INTO '${sqlPath}'`);
  sendFile(res, backupPath, "application/vnd.sqlite3", "countdown-calendar.db");
}

function sendCsvTemplate(res: ServerResponse): void {
  const content = [
    "title,date,category,recurrence,recurrence_interval,notes,color,details_enabled,detail_start_date",
    "Birthday Example,2026-07-09,Birthday,annual,1,Optional summary,#14b8a6,true,1990-07-09",
    "Every Other Week Example,2026-12-31,Personal,weekly,2,Optional summary,#2563eb,false,"
  ].join("\n");

  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="countdown-calendar-import-template.csv"`
  });
  res.end(`${content}\n`);
}

function readJson(req: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > maxBytes) {
        reject(httpError(413, "Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolvePromise({});
        return;
      }

      try {
        resolvePromise(JSON.parse(body));
      } catch {
        reject(httpError(400, "Invalid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload, null, 2));
}

function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const decodedPath = decodeURIComponent(requestPath);
  const filePath = resolve(publicDir, `.${decodedPath}`);

  if (!filePath.startsWith(publicDir + sep) && filePath !== publicDir) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  sendFile(res, filePath, contentType(filePath));
}

function sendFile(
  res: ServerResponse,
  filePath: string,
  type: string,
  downloadName?: string
): void {
  const headers: Record<string, string | number> = {
    "Content-Type": type,
    "Content-Length": statSync(filePath).size,
    "Cache-Control": type.includes("html") ? "no-store" : "public, max-age=300"
  };

  if (downloadName) {
    headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
  }

  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

function contentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
  };

  return types[extension] ?? "application/octet-stream";
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : 500;
    const message = error instanceof Error ? error.message : "Unexpected error";
    sendJson(res, status, { error: message });
  }
}

const host = process.env.HOST ?? "0.0.0.0";
const httpPort = Number(process.env.HTTP_PORT ?? process.env.PORT ?? 80);
const httpsPort = Number(process.env.HTTPS_PORT ?? 443);

createServer(requestHandler).listen(httpPort, host, () => {
  console.log(`HTTP listening on http://${host}:${httpPort}`);
  console.log(`SQLite database: ${dbPath}`);
});

const certPath = process.env.TLS_CERT_PATH;
const keyPath = process.env.TLS_KEY_PATH;

if (certPath && keyPath) {
  createHttpsServer(
    {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath)
    },
    requestHandler
  ).listen(httpsPort, host, () => {
    console.log(`HTTPS listening on https://${host}:${httpsPort}`);
  });
} else {
  console.log("HTTPS disabled. Set TLS_CERT_PATH and TLS_KEY_PATH to enable port 443.");
}
