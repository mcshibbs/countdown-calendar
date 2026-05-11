import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
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
  owner_user_id: number | null;
  calendar_type: CalendarType;
  owner_display_name: string | null;
  created_at: string;
  updated_at: string;
};

type Recurrence = "none" | "daily" | "weekly" | "monthly" | "annual";
type EventSource = "manual" | "federal" | "christian" | "american";
type CalendarType = "builtin" | "personal" | "birthday" | "anniversary" | "custom" | "shared";
type InvitationStatus = "pending" | "accepted" | "declined" | "revoked";

type UserRow = {
  id: number;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string;
  date_of_birth: string;
  password_hash: string;
  password_salt: string;
  mfa_secret: string;
  pending_mfa_secret: string;
  mfa_enabled: number;
  force_mfa_setup: number;
  is_admin: number;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: number;
  user_id: number;
  token_hash: string;
  mfa_verified: number;
  expires_at: string;
  created_at: string;
};

type CalendarShareRow = {
  id: number;
  category_id: number;
  owner_user_id: number;
  invitee_user_id: number | null;
  invitee_email: string;
  status: InvitationStatus;
  created_at: string;
  updated_at: string;
  category_name: string;
  category_color: string;
  owner_display_name: string;
  invitee_display_name: string | null;
};

type CurrentUser = {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  dateOfBirth: string;
  isAdmin: boolean;
};

type EventRow = {
  id: number;
  title: string;
  event_date: string;
  category_id: number;
  recurrence: Recurrence;
  recurrence_interval: number;
  source: EventSource;
  notes: string;
  details_enabled: number;
  detail_start_date: string;
  created_at: string;
  updated_at: string;
  category_name: string;
  category_color: string;
  category_builtin: number;
  category_owner_user_id: number | null;
  category_calendar_type: CalendarType;
  category_owner_display_name: string | null;
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
  categoryOwnerUserId: number | null;
  categoryCalendarType: CalendarType;
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
const sessionCookieName = "cc_session";
const sessionTtlDays = 30;
const passwordIterations = 310_000;
const appIssuer = "Countdown Calendar";

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
    name TEXT NOT NULL COLLATE NOCASE,
    color TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0,
    owner_user_id INTEGER,
    calendar_type TEXT NOT NULL DEFAULT 'custom' CHECK (calendar_type IN ('builtin', 'personal', 'birthday', 'anniversary', 'custom', 'shared')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    date_of_birth TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    mfa_secret TEXT NOT NULL,
    pending_mfa_secret TEXT NOT NULL DEFAULT '',
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    force_mfa_setup INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backup_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    mfa_verified INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS calendar_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    owner_user_id INTEGER NOT NULL,
    invitee_user_id INTEGER,
    invitee_email TEXT NOT NULL COLLATE NOCASE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    recurrence TEXT NOT NULL CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly', 'annual')),
    recurrence_interval INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL CHECK (source IN ('manual', 'federal', 'christian', 'american')),
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
ensureAdminUser();
ensureDefaultSetting("eventDetailsEnabled", "true");
ensureDefaultSetting("darkModeEnabled", "false");
ensureEventIndexes();
seedBuiltIns();

function nowIso(): string {
  return new Date().toISOString();
}

function migrateSchema(): void {
  migrateCategoriesTable();
  ensureColumn("users", "pending_mfa_secret", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("users", "force_mfa_setup", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("events", "details_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("events", "detail_start_date", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("events", "recurrence_interval", "INTEGER NOT NULL DEFAULT 1");
  migrateEventsTableConstraints();
  ensureAuthIndexes();
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function migrateCategoriesTable(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'categories'")
    .get() as { sql: string } | undefined;
  const columns = db.prepare("PRAGMA table_info(categories)").all() as Array<{ name: string }>;
  const hasOwner = columns.some((column) => column.name === "owner_user_id");
  const hasType = columns.some((column) => column.name === "calendar_type");
  const hasLegacyUniqueName = Boolean(row?.sql.includes("name TEXT NOT NULL COLLATE NOCASE UNIQUE"));

  if (hasOwner && hasType && !hasLegacyUniqueName) {
    return;
  }

  const categories = db.prepare("SELECT * FROM categories ORDER BY id ASC").all() as Array<{
    id: number;
    name: string;
    color: string;
    builtin: number;
    owner_user_id?: number | null;
    calendar_type?: CalendarType;
    created_at: string;
    updated_at: string;
  }>;

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;

    CREATE TABLE categories_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      color TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER,
      calendar_type TEXT NOT NULL DEFAULT 'custom' CHECK (calendar_type IN ('builtin', 'personal', 'birthday', 'anniversary', 'custom', 'shared')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO categories_new
      (id, name, color, builtin, owner_user_id, calendar_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const category of categories) {
    insert.run(
      category.id,
      category.name,
      category.color,
      category.builtin ? 1 : 0,
      category.owner_user_id ?? null,
      normalizeCalendarType(category.calendar_type, category.name, category.builtin === 1),
      category.created_at,
      category.updated_at
    );
  }

  db.exec(`
    DROP TABLE categories;
    ALTER TABLE categories_new RENAME TO categories;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function normalizeCalendarType(value: unknown, name: string, builtin: boolean): CalendarType {
  if (
    value === "builtin"
    || value === "personal"
    || value === "birthday"
    || value === "anniversary"
    || value === "custom"
    || value === "shared"
  ) {
    return value;
  }

  const normalizedName = name.trim().toLowerCase();
  if (builtin && normalizedName !== "birthday" && normalizedName !== "anniversaries") {
    return "builtin";
  }
  if (normalizedName === "birthday") {
    return "birthday";
  }
  if (normalizedName === "anniversaries" || normalizedName === "anniversary") {
    return "anniversary";
  }
  return "custom";
}

function ensureAuthIndexes(): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_categories_owner_user_id ON categories(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id ON backup_codes(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_codes_user_hash ON backup_codes(user_id, code_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_shares_category_id ON calendar_shares(category_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_shares_invitee_user_id ON calendar_shares(invitee_user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_shares_invitee_email ON calendar_shares(invitee_email);
    CREATE INDEX IF NOT EXISTS idx_calendar_shares_owner_user_id ON calendar_shares(owner_user_id);
  `);
}

function ensureAdminUser(): void {
  const count = userCount();
  if (count === 0) {
    return;
  }

  const admin = db.prepare("SELECT id FROM users WHERE is_admin = 1 LIMIT 1").get() as
    | { id: number }
    | undefined;
  if (admin) {
    return;
  }

  const firstUser = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as
    | { id: number }
    | undefined;
  if (firstUser) {
    db.prepare("UPDATE users SET is_admin = 1, updated_at = ? WHERE id = ?").run(nowIso(), firstUser.id);
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
    DROP INDEX IF EXISTS idx_seeded_holiday_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seeded_holiday_unique
      ON events(title, event_date, source)
      WHERE source IN ('federal', 'christian', 'american');
  `);
}

function migrateEventsTableConstraints(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'")
    .get() as { sql: string } | undefined;

  if (
    !row
    || (
      !row.sql.includes("recurrence IN ('none', 'annual')")
      && row.sql.includes("'american'")
    )
  ) {
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
      source TEXT NOT NULL CHECK (source IN ('manual', 'federal', 'christian', 'american')),
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
      CASE
        WHEN recurrence IN ('none', 'daily', 'weekly', 'monthly', 'annual') THEN recurrence
        ELSE 'none'
      END,
      COALESCE(recurrence_interval, 1),
      CASE
        WHEN source IN ('manual', 'federal', 'christian', 'american') THEN source
        ELSE 'manual'
      END,
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

function publicUser(user: UserRow): CurrentUser {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    displayName: user.display_name,
    email: user.email,
    dateOfBirth: user.date_of_birth,
    isAdmin: user.is_admin === 1
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPassword(password: string, salt = randomBytes(16).toString("base64")): {
  hash: string;
  salt: string;
} {
  return {
    salt,
    hash: pbkdf2Sync(password, salt, passwordIterations, 32, "sha256").toString("base64")
  };
}

function verifyPassword(password: string, user: UserRow): boolean {
  const expected = Buffer.from(user.password_hash, "base64");
  const actual = Buffer.from(hashPassword(password, user.password_salt).hash, "base64");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createSession(userId: number, mfaVerified: boolean): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + sessionTtlDays);
  const expiresAt = expires.toISOString();

  db.prepare(
    `
    INSERT INTO sessions (user_id, token_hash, mfa_verified, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(userId, hashSessionToken(token), mfaVerified ? 1 : 0, expiresAt, nowIso());

  return { token, expiresAt };
}

function setSessionCookie(res: ServerResponse, token: string, expiresAt: string): void {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  res.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

function parseCookies(req: IncomingMessage): Map<string, string> {
  const cookies = new Map<string, string>();
  const header = req.headers.cookie;
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (!name || !valueParts.length) {
      continue;
    }
    cookies.set(name, decodeURIComponent(valueParts.join("=")));
  }
  return cookies;
}

function getSessionFromRequest(req: IncomingMessage): { user: UserRow; session: SessionRow; token: string } | null {
  const token = parseCookies(req).get(sessionCookieName);
  if (!token) {
    return null;
  }

  const row = db
    .prepare(
      `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.token_hash,
        s.mfa_verified,
        s.expires_at,
        s.created_at AS session_created_at,
        u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
      LIMIT 1
    `
    )
    .get(hashSessionToken(token)) as
    | (UserRow & {
      session_id: number;
      user_id: number;
      token_hash: string;
      mfa_verified: number;
      expires_at: string;
      session_created_at: string;
    })
    | undefined;

  if (!row) {
    return null;
  }

  if (row.expires_at <= nowIso()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.session_id);
    return null;
  }

  return {
    token,
    user: {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      display_name: row.display_name,
      email: row.email,
      date_of_birth: row.date_of_birth,
      password_hash: row.password_hash,
      password_salt: row.password_salt,
      mfa_secret: row.mfa_secret,
      pending_mfa_secret: row.pending_mfa_secret,
      mfa_enabled: row.mfa_enabled,
      force_mfa_setup: row.force_mfa_setup,
      is_admin: row.is_admin,
      created_at: row.created_at,
      updated_at: row.updated_at
    },
    session: {
      id: row.session_id,
      user_id: row.user_id,
      token_hash: row.token_hash,
      mfa_verified: row.mfa_verified,
      expires_at: row.expires_at,
      created_at: row.session_created_at
    }
  };
}

function requireVerifiedSession(req: IncomingMessage): { user: UserRow; session: SessionRow; token: string } {
  const auth = getSessionFromRequest(req);
  if (!auth) {
    throw httpError(401, "Log in to continue.");
  }
  if (auth.user.mfa_enabled !== 1 || auth.user.force_mfa_setup === 1) {
    throw httpError(401, "Finish MFA setup to continue.");
  }
  if (auth.session.mfa_verified !== 1) {
    throw httpError(401, "Enter your authenticator code to continue.");
  }
  return auth;
}

function getUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ? LIMIT 1")
    .get(normalizeEmail(email)) as UserRow | undefined;
}

function getUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id) as UserRow | undefined;
}

function userCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  return row.count;
}

function mfaSetupPayload(user: UserRow, secret = user.mfa_secret) {
  const label = `${appIssuer}:${user.email}`;
  const query = new URLSearchParams({
    secret,
    issuer: appIssuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });

  return {
    secret,
    setupUri: `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`
  };
}

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) {
      throw httpError(400, "Invalid authenticator secret.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateMfaSecret(): string {
  return base32Encode(randomBytes(20));
}

function totp(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (
    ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255)
  ) % 1_000_000;
  return String(code).padStart(6, "0");
}

function verifyTotp(secret: string, code: string): boolean {
  const clean = code.trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) {
    return false;
  }

  const provided = Buffer.from(clean);
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(totp(secret, Date.now() + drift * 30_000));
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return true;
    }
  }
  return false;
}

function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function formatBackupCode(raw: string): string {
  return raw.match(/.{1,5}/g)?.join("-") ?? raw;
}

function generateBackupCode(): string {
  return formatBackupCode(base32Encode(randomBytes(10)).slice(0, 15));
}

function hashBackupCode(userId: number, code: string): string {
  return createHash("sha256").update(`${userId}:${normalizeBackupCode(code)}`).digest("hex");
}

function replaceBackupCodes(userId: number): string[] {
  const codes = Array.from({ length: 10 }, generateBackupCode);
  db.prepare("DELETE FROM backup_codes WHERE user_id = ?").run(userId);

  const insert = db.prepare(
    "INSERT INTO backup_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)"
  );
  for (const code of codes) {
    insert.run(userId, hashBackupCode(userId, code), nowIso());
  }

  return codes;
}

function consumeBackupCode(userId: number, code: string): boolean {
  const normalized = normalizeBackupCode(code);
  if (normalized.length < 10) {
    return false;
  }

  const result = db.prepare(
    `
    UPDATE backup_codes
    SET used_at = ?
    WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
  `
  ).run(nowIso(), userId, hashBackupCode(userId, normalized));

  return result.changes > 0;
}

function verifyMfaOrBackupCode(user: UserRow, code: string): boolean {
  if (verifyTotp(user.mfa_secret, code)) {
    return true;
  }
  return consumeBackupCode(user.id, code);
}

function ensureUserDefaultCalendars(userId: number): void {
  ensureCategory("Personal Calendar", "#0f766e", false, userId, "personal");
  ensureCategory("Birthday", "#14b8a6", false, userId, "birthday");
  ensureCategory("Anniversaries", "#4338ca", false, userId, "anniversary");
}

function claimLegacyCalendarsForUser(userId: number): void {
  db.prepare(
    `
    UPDATE categories
    SET
      owner_user_id = ?,
      builtin = 0,
      calendar_type = CASE
        WHEN lower(name) = 'birthday' THEN 'birthday'
        WHEN lower(name) IN ('anniversaries', 'anniversary') THEN 'anniversary'
        ELSE 'custom'
      END,
      updated_at = ?
    WHERE owner_user_id IS NULL
      AND (builtin = 0 OR lower(name) IN ('birthday', 'anniversaries', 'anniversary'))
  `
  ).run(userId, nowIso());
}

function attachPendingSharesToUser(user: UserRow): void {
  db.prepare(
    `
    UPDATE calendar_shares
    SET invitee_user_id = ?, updated_at = ?
    WHERE invitee_user_id IS NULL AND invitee_email = ?
  `
  ).run(user.id, nowIso(), user.email);
}

function ensureCategory(
  name: string,
  color: string,
  builtin: boolean,
  ownerUserId: number | null = null,
  calendarType: CalendarType = builtin ? "builtin" : "custom"
): number {
  const existing = db
    .prepare(
      `
      SELECT id, color, builtin, owner_user_id, calendar_type
      FROM categories
      WHERE name = ?
        AND ((owner_user_id IS NULL AND ? IS NULL) OR owner_user_id = ?)
      ORDER BY builtin DESC, id ASC
      LIMIT 1
    `
    )
    .get(name, ownerUserId, ownerUserId) as
    | { id: number; color: string; builtin: number; owner_user_id: number | null; calendar_type: CalendarType }
    | undefined;

  if (existing) {
    if (
      existing.color !== color
      || existing.builtin !== (builtin ? 1 : 0)
      || existing.calendar_type !== calendarType
      || existing.owner_user_id !== ownerUserId
    ) {
      db.prepare(
        "UPDATE categories SET color = ?, builtin = ?, owner_user_id = ?, calendar_type = ?, updated_at = ? WHERE id = ?"
      ).run(color, builtin ? 1 : 0, ownerUserId, calendarType, nowIso(), existing.id);
    }
    return existing.id;
  }

  const result = db
    .prepare(
      `
      INSERT INTO categories
        (name, color, builtin, owner_user_id, calendar_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(name, color, builtin ? 1 : 0, ownerUserId, calendarType, nowIso(), nowIso());

  return Number(result.lastInsertRowid);
}

function seedBuiltIns(): void {
  const federalCategoryId = ensureCategory("Federal Holidays", "#f97316", true, null, "builtin");
  const christianCategoryId = ensureCategory("Christian Holidays", "#facc15", true, null, "builtin");
  const americanCategoryId = ensureCategory("American Holidays", "#dc2626", true, null, "builtin");
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

    for (const holiday of americanHolidays(year)) {
      insert.run(holiday.title, holiday.date, americanCategoryId, "american", nowIso(), nowIso());
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

function americanHolidays(year: number): Array<{ title: string; date: string }> {
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4);

  return [
    { title: "Groundhog Day", date: formatDate(utcDate(year, 2, 2)) },
    { title: "Valentine's Day", date: formatDate(utcDate(year, 2, 14)) },
    { title: "St. Patrick's Day", date: formatDate(utcDate(year, 3, 17)) },
    { title: "April Fools' Day", date: formatDate(utcDate(year, 4, 1)) },
    { title: "Tax Day", date: taxDay(year) },
    { title: "Earth Day", date: formatDate(utcDate(year, 4, 22)) },
    { title: "Cinco de Mayo", date: formatDate(utcDate(year, 5, 5)) },
    { title: "Mother's Day", date: formatDate(nthWeekdayOfMonth(year, 5, 0, 2)) },
    { title: "Flag Day", date: formatDate(utcDate(year, 6, 14)) },
    { title: "Father's Day", date: formatDate(nthWeekdayOfMonth(year, 6, 0, 3)) },
    { title: "Patriot Day", date: formatDate(utcDate(year, 9, 11)) },
    { title: "Grandparents Day", date: formatDate(addDays(nthWeekdayOfMonth(year, 9, 1, 1), 6)) },
    { title: "Halloween", date: formatDate(utcDate(year, 10, 31)) },
    { title: "Election Day", date: formatDate(firstTuesdayAfterFirstMondayOfNovember(year)) },
    { title: "Black Friday", date: formatDate(addDays(thanksgiving, 1)) },
    { title: "Cyber Monday", date: formatDate(addDays(thanksgiving, 4)) },
    { title: "Christmas Eve", date: formatDate(utcDate(year, 12, 24)) },
    { title: "New Year's Eve", date: formatDate(utcDate(year, 12, 31)) }
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

function taxDay(year: number): string {
  let date = utcDate(year, 4, 15);
  const weekday = date.getUTCDay();

  if (weekday === 6) {
    date = addDays(date, 2);
  } else if (weekday === 0) {
    date = addDays(date, 1);
  }

  return formatDate(date);
}

function firstTuesdayAfterFirstMondayOfNovember(year: number): Date {
  return addDays(nthWeekdayOfMonth(year, 11, 1, 1), 1);
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

function getUpcomingEvents(daysAhead: number, user: UserRow): UpcomingEvent[] {
  const today = todayDateOnly();
  const rows = db
    .prepare(
      `
      SELECT
        e.*,
        c.name AS category_name,
        c.color AS category_color,
        c.builtin AS category_builtin,
        c.owner_user_id AS category_owner_user_id,
        c.calendar_type AS category_calendar_type,
        owner.display_name AS category_owner_display_name
      FROM events e
      JOIN categories c ON c.id = e.category_id
      LEFT JOIN users owner ON owner.id = c.owner_user_id
      WHERE ${visibleCategoryWhere("c")}
      ORDER BY e.event_date ASC, e.title ASC
    `
    )
    .all(...visibleCategoryParams(user)) as EventRow[];

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
        categoryOwnerUserId: event.category_owner_user_id,
        categoryCalendarType: event.category_calendar_type,
        categoryOwnerDisplayName: event.category_owner_display_name,
        canEdit: event.source === "manual" && event.category_owner_user_id === user.id,
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
  const detail = holidayDetailsForSource(event.source)[key];

  return detail ?? {
    summary: "",
    startDate: "",
    startLabel: event.source === "federal" ? "Federal holiday since" : "Observed since"
  };
}

function normalizeHolidayTitle(title: string): string {
  return title.replace(/\s+\(Observed\)$/i, "").trim();
}

function holidayDetailsForSource(source: EventSource): Record<string, HolidayDetail> {
  if (source === "federal") {
    return FEDERAL_HOLIDAY_DETAILS;
  }

  if (source === "christian") {
    return CHRISTIAN_HOLIDAY_DETAILS;
  }

  if (source === "american") {
    return AMERICAN_HOLIDAY_DETAILS;
  }

  return {};
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

const AMERICAN_HOLIDAY_DETAILS: Record<string, HolidayDetail> = {
  "Groundhog Day": {
    summary: "A folk observance centered on whether a groundhog is said to predict an early spring.",
    startDate: "1887-02-02",
    startLabel: "Popular ceremony since"
  },
  "Valentine's Day": {
    summary: "A widely observed day for cards, gifts, and expressions of affection.",
    startDate: "1840-01-01",
    startLabel: "U.S. cards popular by"
  },
  "St. Patrick's Day": {
    summary: "Celebrates Irish heritage and St. Patrick, with parades and community celebrations across the United States.",
    startDate: "1762-03-17",
    startLabel: "U.S. parade roots"
  },
  "April Fools' Day": {
    summary: "A lighthearted day for jokes, pranks, and playful hoaxes.",
    startDate: "1700-01-01",
    startLabel: "Popular by"
  },
  "Tax Day": {
    summary: "The usual deadline for filing federal individual income tax returns, adjusted here when April 15 falls on a weekend.",
    startDate: "1955-04-15",
    startLabel: "Modern deadline since"
  },
  "Earth Day": {
    summary: "Promotes environmental awareness and action.",
    startDate: "1970-04-22",
    startLabel: "First observed"
  },
  "Cinco de Mayo": {
    summary: "Commemorates Mexico's 1862 victory at Puebla and is widely observed in the United States as a celebration of Mexican heritage.",
    startDate: "1863-05-05",
    startLabel: "U.S. observance roots"
  },
  "Mother's Day": {
    summary: "Honors mothers, motherhood, and maternal bonds.",
    startDate: "1914-05-09",
    startLabel: "U.S. proclamation signed"
  },
  "Flag Day": {
    summary: "Commemorates the adoption of the United States flag.",
    startDate: "1916-05-30",
    startLabel: "Presidential proclamation"
  },
  "Father's Day": {
    summary: "Honors fathers, fatherhood, and paternal bonds.",
    startDate: "1972-04-24",
    startLabel: "Federal recognition signed"
  },
  "Patriot Day": {
    summary: "A day of remembrance for those killed in the September 11, 2001 terrorist attacks.",
    startDate: "2001-12-18",
    startLabel: "Established"
  },
  "Grandparents Day": {
    summary: "Honors grandparents and intergenerational family relationships.",
    startDate: "1978-08-03",
    startLabel: "Established"
  },
  "Halloween": {
    summary: "A cultural holiday associated with costumes, trick-or-treating, and autumn celebrations.",
    startDate: "1900-01-01",
    startLabel: "Popular by"
  },
  "Election Day": {
    summary: "The traditional U.S. general election day, the Tuesday after the first Monday in November.",
    startDate: "1845-01-23",
    startLabel: "Federal election date set"
  },
  "Black Friday": {
    summary: "The shopping day after Thanksgiving, often treated as the start of the holiday shopping season.",
    startDate: "1950-01-01",
    startLabel: "Term popularized by"
  },
  "Cyber Monday": {
    summary: "An online shopping observance on the Monday after Thanksgiving.",
    startDate: "2005-11-28",
    startLabel: "First named"
  },
  "Christmas Eve": {
    summary: "The evening before Christmas Day, commonly marked by gatherings, services, and holiday traditions.",
    startDate: "1800-01-01",
    startLabel: "Common U.S. custom by"
  },
  "New Year's Eve": {
    summary: "The final day of the calendar year, commonly marked by countdowns and celebrations.",
    startDate: "1904-12-31",
    startLabel: "Times Square roots"
  }
};

async function handleAuthApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/auth/session") {
    const auth = getSessionFromRequest(req);
    if (!auth) {
      sendJson(res, 200, { authenticated: false });
      return true;
    }

    if (auth.user.mfa_enabled !== 1 || auth.user.force_mfa_setup === 1) {
      sendJson(res, 200, {
        authenticated: false,
        mfaSetup: mfaSetupPayload(auth.user),
        user: publicUser(auth.user)
      });
      return true;
    }

    if (auth.session.mfa_verified !== 1) {
      sendJson(res, 200, {
        authenticated: false,
        mfaRequired: true,
        user: publicUser(auth.user)
      });
      return true;
    }

    sendJson(res, 200, { authenticated: true, user: publicUser(auth.user) });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/auth/signup") {
    const body = await readJson(req);
    const created = createUserAccount(body);
    const session = createSession(created.user.id, false);
    setSessionCookie(res, session.token, session.expiresAt);
    sendJson(res, 201, {
      authenticated: false,
      mfaSetup: mfaSetupPayload(created.user),
      user: publicUser(created.user)
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const user = validateLogin(body);
    const needsMfaSetup = user.mfa_enabled !== 1 || user.force_mfa_setup === 1;
    const session = createSession(user.id, needsMfaSetup);
    setSessionCookie(res, session.token, session.expiresAt);

    if (!needsMfaSetup) {
      sendJson(res, 200, {
        authenticated: false,
        mfaRequired: true,
        user: publicUser(user)
      });
    } else {
      sendJson(res, 200, {
        authenticated: false,
        mfaSetup: mfaSetupPayload(user),
        user: publicUser(user)
      });
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/api/auth/mfa/enable") {
    const auth = getSessionFromRequest(req);
    if (!auth) {
      throw httpError(401, "Log in to continue.");
    }
    const body = await readJson(req);
    const code = cleanText((body as Record<string, unknown>)?.code, 20, true);
    if (!verifyTotp(auth.user.mfa_secret, code)) {
      throw httpError(400, "Authenticator code was not accepted.");
    }

    const backupCodes = replaceBackupCodes(auth.user.id);
    db.prepare("UPDATE users SET mfa_enabled = 1, force_mfa_setup = 0, updated_at = ? WHERE id = ?")
      .run(nowIso(), auth.user.id);
    db.prepare("UPDATE sessions SET mfa_verified = 1 WHERE id = ?").run(auth.session.id);
    const user = getUserById(auth.user.id);
    if (!user) {
      throw httpError(500, "User could not be loaded.");
    }
    sendJson(res, 200, { authenticated: true, user: publicUser(user), backupCodes });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/auth/mfa/verify") {
    const auth = getSessionFromRequest(req);
    if (!auth) {
      throw httpError(401, "Log in to continue.");
    }
    const body = await readJson(req);
    const code = cleanText((body as Record<string, unknown>)?.code, 20, true);
    if (!verifyMfaOrBackupCode(auth.user, code)) {
      throw httpError(400, "Authenticator code was not accepted.");
    }

    db.prepare("UPDATE sessions SET mfa_verified = 1 WHERE id = ?").run(auth.session.id);
    sendJson(res, 200, { authenticated: true, user: publicUser(auth.user) });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/auth/logout") {
    const auth = getSessionFromRequest(req);
    if (auth) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(auth.session.id);
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

function createUserAccount(body: unknown): { user: UserRow } {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const firstName = cleanText(body.firstName, 80);
  const lastName = cleanText(body.lastName, 80);
  const displayName = cleanText(body.displayName, 80);
  const email = normalizeEmail(cleanText(body.email, 160));
  const dateOfBirth = cleanText(body.dateOfBirth, 10);
  const password = cleanText(body.password, 500);
  const confirmPassword = cleanText(body.confirmPassword, 500);

  if (!firstName || !lastName || !displayName) {
    throw httpError(400, "Name fields are required.");
  }
  if (!validateEmail(email)) {
    throw httpError(400, "Enter a valid email address.");
  }
  if (!isValidDateOnly(dateOfBirth)) {
    throw httpError(400, "Date of birth must be in YYYY-MM-DD format.");
  }
  if (password.length < 10) {
    throw httpError(400, "Password must be at least 10 characters.");
  }
  if (password !== confirmPassword) {
    throw httpError(400, "Passwords do not match.");
  }
  if (getUserByEmail(email)) {
    throw httpError(409, "An account with that email already exists.");
  }

  const firstUser = userCount() === 0;
  const passwordData = hashPassword(password);
  const result = db.prepare(
    `
    INSERT INTO users
      (first_name, last_name, display_name, email, date_of_birth, password_hash, password_salt, mfa_secret, pending_mfa_secret, mfa_enabled, force_mfa_setup, is_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 0, 0, ?, ?, ?)
  `
  ).run(
    firstName,
    lastName,
    displayName,
    email,
    dateOfBirth,
    passwordData.hash,
    passwordData.salt,
    generateMfaSecret(),
    firstUser ? 1 : 0,
    nowIso(),
    nowIso()
  );

  const user = getUserById(Number(result.lastInsertRowid));
  if (!user) {
    throw httpError(500, "User could not be created.");
  }

  if (firstUser) {
    claimLegacyCalendarsForUser(user.id);
  }
  ensureUserDefaultCalendars(user.id);
  attachPendingSharesToUser(user);
  return { user };
}

function validateLogin(body: unknown): UserRow {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const email = normalizeEmail(cleanText(body.email, 160));
  const password = cleanText(body.password, 500);
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user)) {
    throw httpError(401, "Email or password was not accepted.");
  }

  attachPendingSharesToUser(user);
  return user;
}

function requireAdmin(user: UserRow): void {
  if (user.is_admin !== 1) {
    throw httpError(403, "Admin access is required.");
  }
}

function generateUserBackupCodes(user: UserRow) {
  return { backupCodes: replaceBackupCodes(user.id) };
}

function startMfaReset(body: unknown, user: UserRow) {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const password = cleanText(body.password, 500);
  if (!verifyPassword(password, user)) {
    throw httpError(401, "Password was not accepted.");
  }

  const pendingSecret = generateMfaSecret();
  db.prepare("UPDATE users SET pending_mfa_secret = ?, updated_at = ? WHERE id = ?")
    .run(pendingSecret, nowIso(), user.id);

  return { mfaSetup: mfaSetupPayload(user, pendingSecret) };
}

function confirmMfaReset(body: unknown, user: UserRow) {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const current = getUserById(user.id);
  if (!current?.pending_mfa_secret) {
    throw httpError(400, "Start authenticator setup first.");
  }

  const code = cleanText(body.code, 20, true);
  if (!verifyTotp(current.pending_mfa_secret, code)) {
    throw httpError(400, "Authenticator code was not accepted.");
  }

  const backupCodes = replaceBackupCodes(user.id);
  db.prepare(
    `
    UPDATE users
    SET mfa_secret = ?, pending_mfa_secret = '', mfa_enabled = 1, force_mfa_setup = 0, updated_at = ?
    WHERE id = ?
  `
  ).run(current.pending_mfa_secret, nowIso(), user.id);

  return { backupCodes, user: publicUser(getUserById(user.id) ?? current) };
}

function adminSummary() {
  const users = db
    .prepare(
      `
      SELECT id, first_name, last_name, display_name, email, date_of_birth, mfa_enabled, force_mfa_setup, is_admin, created_at, updated_at
      FROM users
      ORDER BY display_name COLLATE NOCASE ASC, email COLLATE NOCASE ASC
    `
    )
    .all() as Array<{
      id: number;
      first_name: string;
      last_name: string;
      display_name: string;
      email: string;
      date_of_birth: string;
      mfa_enabled: number;
      force_mfa_setup: number;
      is_admin: number;
      created_at: string;
      updated_at: string;
    }>;

  const pendingInvites = db
    .prepare(
      `
      SELECT
        s.invitee_email,
        COUNT(*) AS invite_count,
        MAX(s.updated_at) AS updated_at
      FROM calendar_shares s
      LEFT JOIN users u ON u.email = s.invitee_email
      WHERE s.status = 'pending' AND u.id IS NULL
      GROUP BY s.invitee_email
      ORDER BY s.invitee_email COLLATE NOCASE ASC
    `
    )
    .all() as Array<{ invitee_email: string; invite_count: number; updated_at: string }>;

  return {
    users: users.map((user) => ({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      displayName: user.display_name,
      email: user.email,
      dateOfBirth: user.date_of_birth,
      mfaEnabled: user.mfa_enabled === 1,
      forceMfaSetup: user.force_mfa_setup === 1,
      isAdmin: user.is_admin === 1,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    })),
    pendingInvites: pendingInvites.map((invite) => ({
      email: invite.invitee_email,
      inviteCount: invite.invite_count,
      updatedAt: invite.updated_at
    }))
  };
}

function updateUserAsAdmin(userId: number, body: unknown) {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const existing = getUserById(userId);
  if (!existing) {
    throw httpError(404, "User not found.");
  }

  const firstName = cleanText(body.firstName, 80);
  const lastName = cleanText(body.lastName, 80);
  const displayName = cleanText(body.displayName, 80);
  const email = normalizeEmail(cleanText(body.email, 160));
  const dateOfBirth = cleanText(body.dateOfBirth, 10);

  if (!firstName || !lastName || !displayName) {
    throw httpError(400, "Name fields are required.");
  }
  if (!validateEmail(email)) {
    throw httpError(400, "Enter a valid email address.");
  }
  if (!isValidDateOnly(dateOfBirth)) {
    throw httpError(400, "Date of birth must be in YYYY-MM-DD format.");
  }

  const duplicate = getUserByEmail(email);
  if (duplicate && duplicate.id !== userId) {
    throw httpError(409, "Another account already uses that email.");
  }

  db.prepare(
    `
    UPDATE users
    SET first_name = ?, last_name = ?, display_name = ?, email = ?, date_of_birth = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(firstName, lastName, displayName, email, dateOfBirth, nowIso(), userId);

  const updated = getUserById(userId);
  if (updated) {
    attachPendingSharesToUser(updated);
  }
  return adminSummary();
}

function resetUserPasswordAsAdmin(userId: number, body: unknown) {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const user = getUserById(userId);
  if (!user) {
    throw httpError(404, "User not found.");
  }

  const password = cleanText(body.password, 500);
  if (password.length < 10) {
    throw httpError(400, "Password must be at least 10 characters.");
  }

  const passwordData = hashPassword(password);
  db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
    .run(passwordData.hash, passwordData.salt, nowIso(), userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return adminSummary();
}

function requireUserMfaResetAsAdmin(userId: number) {
  const user = getUserById(userId);
  if (!user) {
    throw httpError(404, "User not found.");
  }

  db.prepare(
    `
    UPDATE users
    SET mfa_secret = ?, pending_mfa_secret = '', mfa_enabled = 0, force_mfa_setup = 1, updated_at = ?
    WHERE id = ?
  `
  ).run(generateMfaSecret(), nowIso(), userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM backup_codes WHERE user_id = ?").run(userId);
  return adminSummary();
}

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

  if (url.pathname.startsWith("/api/auth/")) {
    if (await handleAuthApi(req, res, url)) {
      return;
    }
  }

  const auth = requireVerifiedSession(req);
  const user = auth.user;

  if (method === "POST" && url.pathname === "/api/security/backup-codes") {
    sendJson(res, 200, generateUserBackupCodes(user));
    return;
  }

  if (method === "POST" && url.pathname === "/api/security/mfa/start-reset") {
    const body = await readJson(req);
    sendJson(res, 200, startMfaReset(body, user));
    return;
  }

  if (method === "POST" && url.pathname === "/api/security/mfa/confirm-reset") {
    const body = await readJson(req);
    sendJson(res, 200, confirmMfaReset(body, user));
    return;
  }

  if (url.pathname.startsWith("/api/admin")) {
    requireAdmin(user);

    if (method === "GET" && url.pathname === "/api/admin/summary") {
      sendJson(res, 200, adminSummary());
      return;
    }

    const userMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userMatch && method === "PUT") {
      const body = await readJson(req);
      sendJson(res, 200, updateUserAsAdmin(Number(userMatch[1]), body));
      return;
    }

    const passwordMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/);
    if (passwordMatch && method === "POST") {
      const body = await readJson(req);
      sendJson(res, 200, resetUserPasswordAsAdmin(Number(passwordMatch[1]), body));
      return;
    }

    const mfaMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/require-mfa-reset$/);
    if (mfaMatch && method === "POST") {
      sendJson(res, 200, requireUserMfaResetAsAdmin(Number(mfaMatch[1])));
      return;
    }
  }

  if (method === "GET" && url.pathname === "/api/categories") {
    const categories = listVisibleCategories(user);
    sendJson(res, 200, { categories: categories.map((category) => formatCategory(category, user)) });
    return;
  }

  if (method === "GET" && url.pathname === "/api/events") {
    const days = clampNumber(Number(url.searchParams.get("days") ?? 730), 30, 3650);
    sendJson(res, 200, { events: getUpcomingEvents(days, user) });
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
    const created = createManualEvent(body, user);
    sendJson(res, 201, { event: created });
    return;
  }

  if (method === "POST" && url.pathname === "/api/import") {
    const body = await readJson(req, 5_000_000);
    const result = importManualEvents(body, user);
    sendJson(res, 200, result);
    return;
  }

  if (method === "GET" && url.pathname === "/api/shares") {
    sendJson(res, 200, getShareState(user));
    return;
  }

  if (method === "POST" && url.pathname === "/api/shares/invite") {
    const body = await readJson(req);
    sendJson(res, 201, inviteToCalendar(body, user));
    return;
  }

  if (method === "POST" && url.pathname === "/api/shares/respond") {
    const body = await readJson(req);
    sendJson(res, 200, respondToShare(body, user));
    return;
  }

  if (method === "POST" && url.pathname === "/api/shares/revoke") {
    const body = await readJson(req);
    sendJson(res, 200, revokeShare(body, user));
    return;
  }

  if (method === "POST" && url.pathname === "/api/calendars/shared") {
    const body = await readJson(req);
    sendJson(res, 201, createSharedCalendar(body, user));
    return;
  }

  const eventMatch = url.pathname.match(/^\/api\/events\/(\d+)$/);
  if (eventMatch && method === "PUT") {
    const body = await readJson(req);
    const updated = updateManualEvent(Number(eventMatch[1]), body, user);
    sendJson(res, 200, { event: updated });
    return;
  }

  if (eventMatch && method === "DELETE") {
    deleteManualEvent(Number(eventMatch[1]), user);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/export") {
    const categories = listVisibleCategories(user);
    const events = db
      .prepare(
        `
        SELECT e.*
        FROM events e
        JOIN categories c ON c.id = e.category_id
        WHERE ${visibleCategoryWhere("c")}
        ORDER BY e.event_date ASC, e.title ASC
      `
      )
      .all(...visibleCategoryParams(user));

    sendJson(
      res,
      200,
      {
        exportedAt: nowIso(),
        schemaVersion: 3,
        user: publicUser(user),
        categories: categories.map((category) => formatCategory(category, user)),
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

function visibleCategoryWhere(alias: string): string {
  return `
    (
      ${alias}.builtin = 1
      OR ${alias}.owner_user_id = ?
      OR EXISTS (
        SELECT 1
        FROM calendar_shares visible_share
        WHERE visible_share.category_id = ${alias}.id
          AND visible_share.status = 'accepted'
          AND (visible_share.invitee_user_id = ? OR visible_share.invitee_email = ?)
      )
    )
  `;
}

function visibleCategoryParams(user: UserRow): [number, number, string] {
  return [user.id, user.id, user.email];
}

function listVisibleCategories(user: UserRow): CategoryRow[] {
  return db
    .prepare(
      `
      SELECT c.*, owner.display_name AS owner_display_name
      FROM categories c
      LEFT JOIN users owner ON owner.id = c.owner_user_id
      WHERE ${visibleCategoryWhere("c")}
      ORDER BY builtin DESC, owner_user_id IS NOT NULL ASC, name ASC
    `
    )
    .all(...visibleCategoryParams(user)) as CategoryRow[];
}

function formatCategory(category: CategoryRow, user: UserRow) {
  const owned = category.owner_user_id === user.id;
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    builtin: category.builtin === 1,
    ownerUserId: category.owner_user_id,
    ownerDisplayName: category.owner_display_name,
    calendarType: category.calendar_type,
    canAddEvents: owned && category.builtin !== 1,
    canShare: owned && category.builtin !== 1,
    sharedWithMe: category.owner_user_id !== null && !owned
  };
}

function getOwnedShareableCalendars(user: UserRow): CategoryRow[] {
  return db
    .prepare(
      `
      SELECT c.*, owner.display_name AS owner_display_name
      FROM categories c
      LEFT JOIN users owner ON owner.id = c.owner_user_id
      WHERE c.owner_user_id = ? AND c.builtin = 0
      ORDER BY
        CASE calendar_type
          WHEN 'personal' THEN 0
          WHEN 'birthday' THEN 1
          WHEN 'anniversary' THEN 2
          WHEN 'shared' THEN 3
          ELSE 4
        END,
        name ASC
    `
    )
    .all(user.id) as CategoryRow[];
}

function shareRowSelect(where: string): string {
  return `
    SELECT
      s.*,
      c.name AS category_name,
      c.color AS category_color,
      owner.display_name AS owner_display_name,
      invitee.display_name AS invitee_display_name
    FROM calendar_shares s
    JOIN categories c ON c.id = s.category_id
    JOIN users owner ON owner.id = s.owner_user_id
    LEFT JOIN users invitee ON invitee.id = s.invitee_user_id
    WHERE ${where}
    ORDER BY s.updated_at DESC, s.created_at DESC
  `;
}

function formatShare(row: CalendarShareRow) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    inviteeUserId: row.invitee_user_id,
    inviteeEmail: row.invitee_email,
    inviteeDisplayName: row.invitee_display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getShareState(user: UserRow) {
  const ownedCalendars = getOwnedShareableCalendars(user).map((category) => formatCategory(category, user));
  const incoming = db
    .prepare(shareRowSelect("s.status = 'pending' AND (s.invitee_user_id = ? OR s.invitee_email = ?)"))
    .all(user.id, user.email) as CalendarShareRow[];
  const outgoing = db
    .prepare(shareRowSelect("s.owner_user_id = ? AND s.status IN ('pending', 'accepted', 'declined')"))
    .all(user.id) as CalendarShareRow[];
  const sharedWithMe = db
    .prepare(shareRowSelect("s.status = 'accepted' AND (s.invitee_user_id = ? OR s.invitee_email = ?)"))
    .all(user.id, user.email) as CalendarShareRow[];

  return {
    ownedCalendars,
    incoming: incoming.map(formatShare),
    outgoing: outgoing.map(formatShare),
    sharedWithMe: sharedWithMe.map(formatShare)
  };
}

function ownedCategoryForShare(categoryId: number, user: UserRow): CategoryRow {
  const category = db
    .prepare("SELECT * FROM categories WHERE id = ? AND owner_user_id = ? AND builtin = 0 LIMIT 1")
    .get(categoryId, user.id) as CategoryRow | undefined;

  if (!category) {
    throw httpError(404, "Calendar not found.");
  }
  return category;
}

function inviteToCalendar(body: unknown, user: UserRow) {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const categoryId = Number(body.categoryId ?? 0);
  const inviteeEmail = normalizeEmail(cleanText(body.email, 160));
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw httpError(400, "Choose a calendar to share.");
  }
  if (!validateEmail(inviteeEmail)) {
    throw httpError(400, "Enter a valid invitee email address.");
  }
  if (inviteeEmail === user.email) {
    throw httpError(400, "You already own that calendar.");
  }

  const category = ownedCategoryForShare(categoryId, user);
  const invitee = getUserByEmail(inviteeEmail);
  const existing = db
    .prepare(
      `
      SELECT id, status
      FROM calendar_shares
      WHERE category_id = ? AND invitee_email = ?
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(category.id, inviteeEmail) as { id: number; status: InvitationStatus } | undefined;

  if (existing) {
    db.prepare(
      `
      UPDATE calendar_shares
      SET invitee_user_id = ?, status = 'pending', updated_at = ?
      WHERE id = ?
    `
    ).run(invitee?.id ?? null, nowIso(), existing.id);
  } else {
    db.prepare(
      `
      INSERT INTO calendar_shares
        (category_id, owner_user_id, invitee_user_id, invitee_email, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `
    ).run(category.id, user.id, invitee?.id ?? null, inviteeEmail, nowIso(), nowIso());
  }

  return getShareState(user);
}

function respondToShare(body: unknown, user: UserRow) {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const shareId = Number(body.shareId ?? 0);
  const action = cleanText(body.action, 20, true);
  if (!Number.isInteger(shareId) || shareId <= 0) {
    throw httpError(400, "Choose an invitation.");
  }
  if (action !== "accept" && action !== "decline") {
    throw httpError(400, "Choose accept or decline.");
  }

  const share = db
    .prepare(
      `
      SELECT *
      FROM calendar_shares
      WHERE id = ?
        AND status = 'pending'
        AND (invitee_user_id = ? OR invitee_email = ?)
      LIMIT 1
    `
    )
    .get(shareId, user.id, user.email) as CalendarShareRow | undefined;

  if (!share) {
    throw httpError(404, "Invitation not found.");
  }

  db.prepare(
    "UPDATE calendar_shares SET invitee_user_id = ?, status = ?, updated_at = ? WHERE id = ?"
  ).run(user.id, action === "accept" ? "accepted" : "declined", nowIso(), shareId);

  return getShareState(user);
}

function revokeShare(body: unknown, user: UserRow) {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const shareId = Number(body.shareId ?? 0);
  if (!Number.isInteger(shareId) || shareId <= 0) {
    throw httpError(400, "Choose an invitation or share.");
  }

  const result = db.prepare(
    `
    UPDATE calendar_shares
    SET status = 'revoked', updated_at = ?
    WHERE id = ? AND owner_user_id = ? AND status IN ('pending', 'accepted', 'declined')
  `
  ).run(nowIso(), shareId, user.id);

  if (result.changes === 0) {
    throw httpError(404, "Share not found.");
  }

  return getShareState(user);
}

function createSharedCalendar(body: unknown, user: UserRow) {
  if (!isRecord(body)) {
    throw httpError(400, "Expected a JSON object.");
  }

  const name = cleanText(body.name, 80);
  const color = cleanText(body.color, 20, true) || "#2563eb";
  const inviteeEmail = normalizeEmail(cleanText(body.email, 160, true));

  if (name.length < 2) {
    throw httpError(400, "Calendar names need at least two characters.");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw httpError(400, "Calendar color must be a hex color.");
  }
  if (inviteeEmail && !validateEmail(inviteeEmail)) {
    throw httpError(400, "Enter a valid invitee email address.");
  }

  const categoryId = ensureCategory(name, color, false, user.id, "shared");
  if (inviteeEmail) {
    inviteToCalendar({ categoryId, email: inviteeEmail }, user);
  }

  return {
    category: formatCategory(ownedCategoryForShare(categoryId, user), user),
    shares: getShareState(user)
  };
}

function createManualEvent(body: unknown, user: UserRow): UpcomingEvent {
  const input = validateEventInput(body);
  const categoryId = resolveCategory(input, user);
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

  const event = getUpcomingEvents(3650, user).find((item) => item.id === Number(result.lastInsertRowid));
  if (!event) {
    throw httpError(500, "Event was saved but could not be loaded.");
  }
  return event;
}

function updateManualEvent(id: number, body: unknown, user: UserRow): UpcomingEvent {
  const existing = db
    .prepare(
      `
      SELECT e.source, c.owner_user_id
      FROM events e
      JOIN categories c ON c.id = e.category_id
      WHERE e.id = ?
    `
    )
    .get(id) as
    | { source: string; owner_user_id: number | null }
    | undefined;

  if (!existing) {
    throw httpError(404, "Event not found.");
  }

  if (existing.source !== "manual") {
    throw httpError(403, "Built-in holidays cannot be edited.");
  }
  if (existing.owner_user_id !== user.id) {
    throw httpError(403, "You can only edit events on calendars you own.");
  }

  const input = validateEventInput(body);
  const categoryId = resolveCategory(input, user);

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

  const event = getUpcomingEvents(3650, user).find((item) => item.id === id);
  if (!event) {
    throw httpError(500, "Event was updated but could not be loaded.");
  }
  return event;
}

function deleteManualEvent(id: number, user: UserRow): void {
  const existing = db
    .prepare(
      `
      SELECT e.source, c.owner_user_id
      FROM events e
      JOIN categories c ON c.id = e.category_id
      WHERE e.id = ?
    `
    )
    .get(id) as
    | { source: string; owner_user_id: number | null }
    | undefined;

  if (!existing) {
    throw httpError(404, "Event not found.");
  }

  if (existing.source !== "manual") {
    throw httpError(403, "Built-in holidays cannot be deleted.");
  }
  if (existing.owner_user_id !== user.id) {
    throw httpError(403, "You can only delete events on calendars you own.");
  }

  db.prepare("DELETE FROM events WHERE id = ?").run(id);
}

function importManualEvents(body: unknown, user: UserRow): { imported: number; skipped: number; errors: string[] } {
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

      const categoryId = resolveCategoryByName(eventCategoryName, eventCategoryColor, user);
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

function resolveCategoryByName(name: string, color: string, user: UserRow): number {
  const existing = db
    .prepare("SELECT id FROM categories WHERE name = ? AND owner_user_id = ? AND builtin = 0 LIMIT 1")
    .get(name, user.id) as { id: number } | undefined;

  if (existing) {
    return existing.id;
  }

  return ensureCategory(name, color, false, user.id, calendarTypeForManualCategoryName(name));
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

function resolveCategory(input: ReturnType<typeof validateEventInput>, user: UserRow): number {
  if (input.categoryName) {
    const existing = db
      .prepare("SELECT id FROM categories WHERE name = ? AND owner_user_id = ? AND builtin = 0 LIMIT 1")
      .get(input.categoryName, user.id) as { id: number } | undefined;

    if (existing) {
      return existing.id;
    }

    if (!input.categoryColor) {
      throw httpError(400, "Pick a color for the new category.");
    }

    return ensureCategory(
      input.categoryName,
      input.categoryColor,
      false,
      user.id,
      calendarTypeForManualCategoryName(input.categoryName)
    );
  }

  const existing = db
    .prepare("SELECT id FROM categories WHERE id = ? AND owner_user_id = ? AND builtin = 0 LIMIT 1")
    .get(input.categoryId, user.id) as { id: number } | undefined;

  if (!existing) {
    throw httpError(400, "Choose a calendar you own.");
  }

  return existing.id;
}

function calendarTypeForManualCategoryName(name: string): CalendarType {
  const normalized = name.trim().toLowerCase();
  if (normalized === "birthday") {
    return "birthday";
  }
  if (normalized === "anniversaries" || normalized === "anniversary") {
    return "anniversary";
  }
  if (normalized === "personal calendar" || normalized === "personal") {
    return "personal";
  }
  return "custom";
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
