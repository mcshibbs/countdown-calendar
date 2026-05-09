# Countdown Calendar

A dependency-free HTML/CSS/TypeScript countdown calendar with a SQLite database. It seeds U.S. federal holidays in orange, Christian holidays in yellow, and lets you add birthdays, anniversaries, and any other event with custom category colors.

Version 1.1 adds Home/Add Event/Settings navigation, moves exports into Settings, and includes bulk import for `.ics`, JSON, and CSV files.

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

- `GET /api/export` for a JSON export of categories and events.
- `GET /api/export.db` for a consistent SQLite backup made with `VACUUM INTO`.
- `POST /api/import` for bulk event import from `.ics`, JSON, or CSV content.

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
