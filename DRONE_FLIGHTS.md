# Drone Flights

Drone flights are built-in scheduled maintenance tasks registered automatically at runtime start.
They run on cron schedules and execute prompts via the scheduler.

## Built-in Flights

- **Light Check** (every 5 min): Quick health checks, error monitoring.
- **Hourly Deep Maintenance** (every hour): Log analysis, auto-fix known issues.
- **Weekly Deep Dive** (every Monday 00:00): Comprehensive review and trend analysis.
- **Hourly X AI+Tech Digest** (every hour): Top AI + tech developments from X.

## Realtime Alerts (Main Agent)

Drone flights are scheduled. For **near-realtime** log watching + incident auto-investigation + notifications, configure the Main Agent:
- `mainAgent.errorScanIntervalMs` (how often it scans logs)
- `mainAgent.notifySessions` (WhatsApp/Telegram session keys)

See `docs/config.md` for details.

## Hourly X AI+Tech Digest

This flight uses the `bird` CLI and Safari cookies for `x.com`.

### Requirements

- `bird` CLI installed and available on PATH.
- Safari must be logged into `x.com`.
- The runtime process needs permission to read Safari cookies (Full Disk Access may be required).
- You can bypass Safari access by setting `BIRD_AUTH_TOKEN` and `BIRD_CT0`.

### Cookie Helper

The flight runs:

```bash
node ./scripts/x-safari-cookies.js --format args --domain x.com,twitter.com
```

This script reads Safari's `Cookies.binarycookies` and outputs arguments compatible with `bird`.
You can override with env vars:

```
BIRD_AUTH_TOKEN
BIRD_CT0
```

If cookies are missing, the prompt will output `AUTH FAILURE` and stop.

### Output

The digest is written to:

```
~/.ant/reports/x-ai-tech-YYYY-MM-DD-HH.md
```

and also printed to stdout for the scheduler log.

### Delivery (WhatsApp + Telegram)

The flight will send the full report via the `message_send` tool if you set:

```
ANT_X_DIGEST_WHATSAPP_TO=whatsapp:dm:12345@s.whatsapp.net
ANT_X_DIGEST_TELEGRAM_TO=telegram:dm:12345
```

Notes:
- WhatsApp: you can also pass a raw JID like `12345@s.whatsapp.net`.
- Telegram: use a full session key (`telegram:dm:<chatId>` or `telegram:group:<chatId>`) to avoid channel inference to WhatsApp.
