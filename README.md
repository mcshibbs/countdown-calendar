# Countdown Calendar

A dependency-free HTML/CSS/TypeScript countdown calendar with a SQLite database. It seeds U.S. federal holidays in orange, Christian holidays in yellow, and lets you add birthdays, anniversaries, and any other event with custom category colors.

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

To move instances, either use the `Download DB` button or stop the service and copy `calendar.db*` to the new VM or LXC container.

## Ubuntu VM Setup

Install Node 24:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Copy this project to `/opt/countdown-calendar`, then build once:

```bash
cd /opt/countdown-calendar
node --experimental-strip-types scripts/build-client.ts
```

Create the data directory:

```bash
sudo mkdir -p /var/lib/countdown-calendar
sudo chown -R www-data:www-data /var/lib/countdown-calendar
```

Install the included systemd service:

```bash
sudo cp countdown-calendar.service /etc/systemd/system/countdown-calendar.service
```

Start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now countdown-calendar
```

HTTP will listen on port 80. HTTPS listens on port 443 when `TLS_CERT_PATH` and `TLS_KEY_PATH` are set.

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
