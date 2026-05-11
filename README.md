# Countdown Calendar

A dependency-free HTML/CSS/TypeScript countdown calendar with a SQLite database. It seeds U.S. federal holidays in orange, Christian holidays in yellow, and lets you add birthdays, anniversaries, and any other event with custom category colors.

Version 1.1 adds Home/Add Event/Settings navigation, moves exports into Settings, and includes bulk import for `.ics`, JSON, and CSV files. Version 1.1.1 folds navigation into a collapsible menu and opens Add Event as a modal over the Home screen. Version 1.1.2 improves iOS/mobile spacing and stacks category labels vertically on narrow screens. Version 1.1.3 adds a collapsible calendar filter with per-category on/off toggles. Version 1.1.4 adds manual-entry action menus and a downloadable CSV import template. Version 1.1.5 adds expandable holiday and custom event details with a Settings toggle. Version 1.2 adds dark mode, compact view options, calendar views, built-in Birthday and Anniversaries calendars, and richer recurrence rules. Version 1.2.1 adds a separate American Holidays calendar for common U.S. cultural observances. Version 1.3 adds multi-user accounts, login sessions, authenticator-app MFA, personal calendars, shared calendars, and in-app calendar invitations. Version 1.4 adds a modal login/signup flow, MFA backup codes, authenticator reset, and an admin portal.

## Local Run

Requirements:

- Node.js 24 or newer

Node may print an experimental warning for its built-in SQLite module; the app does not require any npm packages.

Build the browser JavaScript from the TypeScript source:

```bash
node --experimental-strip-types scripts/build-client.ts
```

Run on a high port for local testing:

```bash
HTTP_PORT=8080 node --experimental-strip-types src/server.ts
```

Open `http://localhost:8080`.

## Data

The default database is:

```text
data/calendar.db
```

Set a different location with `DB_PATH`:

```bash
DB_PATH=/var/lib/countdown-calendar/calendar.db HTTP_PORT=80 node --experimental-strip-types src/server.ts
```

The app also exposes:

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/mfa/enable`, `POST /api/auth/mfa/verify`, and `POST /api/auth/logout` for account access.
- `POST /api/security/backup-codes`, `POST /api/security/mfa/start-reset`, and `POST /api/security/mfa/confirm-reset` for backup codes and authenticator resets.
- `GET /api/admin/summary`, `PUT /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`, and `POST /api/admin/users/:id/require-mfa-reset` for admin account management.
- `GET /api/export` for a JSON export of categories and events.
- `GET /api/export.db` for a consistent SQLite backup made with `VACUUM INTO`.
- `GET /api/import-template.csv` for a CSV file with the supported import columns.
- `POST /api/import` for bulk event import from `.ics`, JSON, or CSV content.
- `GET /api/settings` and `PUT /api/settings` for persisted display settings.
- `GET /api/shares`, `POST /api/shares/invite`, `POST /api/shares/respond`, `POST /api/shares/revoke`, and `POST /api/calendars/shared` for calendar sharing.

Custom events can include optional expandable details. Use the Add Event checkbox or the CSV/JSON import fields `details_enabled` and `detail_start_date`; the existing `notes`/`description` value becomes the summary. Manual recurrence supports `none`, `daily`, `weekly`, `monthly`, and `annual`; use `recurrence_interval` for every-N-day/week/month/year schedules. Built-in holiday calendars include Federal Holidays, Christian Holidays, and American Holidays. Every user also gets their own Personal Calendar, Birthday, and Anniversaries calendars.

Calendar invitations are stored in the app and appear under Settings for users with matching email addresses. Outbound email invitations are not enabled yet because that needs SMTP or a transactional email provider configuration.

The first account created is automatically an admin. If you are upgrading an existing multi-user database without an admin flag, the oldest user is promoted to admin during startup.

To move instances, either use the `Download DB` button or stop the service and copy `calendar.db*` to the new VM or LXC container.

## Ubuntu VM Setup

Run this on the Ubuntu VM:

```bash
curl -fsSL https://raw.githubusercontent.com/mcshibbs/countdown-calendar/main/scripts/install-ubuntu.sh | sudo bash
```

The installer:

- Installs Git, curl, certificates, and Node.js 24 when needed.
- Clones or updates this repo at `/opt/countdown-calendar`.
- Builds the browser JavaScript.
- Creates `/var/lib/countdown-calendar`.
- Installs and starts the systemd service.

Check it:

```bash
systemctl status countdown-calendar
curl http://localhost/api/health
```

HTTP will listen on port 80. HTTPS listens on port 443 when `TLS_CERT_PATH` and `TLS_KEY_PATH` are set.

To use a different repo, branch, app path, or data path:

```bash
curl -fsSL https://raw.githubusercontent.com/mcshibbs/countdown-calendar/main/scripts/install-ubuntu.sh | sudo env REPO_URL=https://github.com/mcshibbs/countdown-calendar.git BRANCH=main APP_DIR=/opt/countdown-calendar DATA_DIR=/var/lib/countdown-calendar bash
```

## HTTPS

Use any certificate files readable by the service user. With Let's Encrypt, one common path is:

```bash
sudo apt-get install -y certbot
sudo certbot certonly --standalone -d calendar.example.com
```

Then uncomment and update `TLS_CERT_PATH` and `TLS_KEY_PATH` in the systemd service.

## Configuration

Environment variables:

- `HOST`: bind address, default `0.0.0.0`
- `HTTP_PORT`: HTTP port, default `80`
- `HTTPS_PORT`: HTTPS port, default `443`
- `DB_PATH`: SQLite database path, default `data/calendar.db`
- `TLS_CERT_PATH`: certificate path for HTTPS
- `TLS_KEY_PATH`: private key path for HTTPS
