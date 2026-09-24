# Ionnet Mailer

A complete, self-hosted mail system in one `docker compose up`:

- **Postfix** (SMTP in/out, submission 587, SMTPS 465)
- **Dovecot 2.4** (IMAP 993, POP3 995, ManageSieve, full-text search)
- **rspamd** (spam filtering, DKIM + ARC signing, SPF/DMARC checks) with optional **ClamAV**
- **PostgreSQL** (domains, mailboxes, aliases) and **Valkey**
- **Caddy** (automatic Let's Encrypt certificates, shared with Postfix/Dovecot)
- **Ionnet Mailer app**: a modern web mail client plus an admin area to add domains,
  mailboxes and aliases, with a DNS setup guide that verifies your records live.

## Requirements

- A VPS with a public IPv4 address and **outbound port 25 allowed** (ask your provider; many block it by default).
- Docker Engine 25+ with Compose v2.
- A hostname for the server, e.g. `mail.example.com`, with:
  - an **A record** pointing at the VPS,
  - a **PTR (reverse DNS) record** for the VPS IP pointing back to `mail.example.com`
    (set this in your VPS provider's control panel).
- Ports 25, 80, 443, 465, 587, 993, 995 and 4190 free on the host.

## Production setup

```bash
git clone <this repo> ionmailer && cd ionmailer
cp .env.example .env
# edit .env: MAIL_HOSTNAME, ACME_EMAIL and every password (openssl rand -hex 32)
docker compose up -d --build
docker compose logs -f app        # shows the one-time setup token
```

Open `https://mail.example.com`. The setup wizard asks for the token from the logs,
checks your hostname and reverse DNS, creates the first domain and the first admin
mailbox, and then shows the DNS records to publish for that domain with live verification.

Afterwards, log in with the admin mailbox. **Admin → Domains** lets you add more domains,
mailboxes and aliases at any time; each domain has its own DNS guide. A mailbox can be made
send-only (turn off **Receives mail**) for addresses like `noreply@`: it can still sign in and
send, but mail addressed to it is rejected during the SMTP conversation.

### The admin area

- **Overview**: what needs attention (services down, certificate expiry, DNS problems,
  stuck mail, password guessing, full mailboxes, low disk), mail traffic and failed
  sign-ins over 24 hours, 7 or 30 days, and the server's disk, memory and load.
- **Mail flow**: the mail log (every recipient of every message Postfix accepted, delivered,
  deferred, bounced or rejected, searchable by address, subject, queue ID or IP), the mail
  queue with retry, hold and delete, and rspamd's recent spam verdicts with their rules.
- **Security**: every sign-in attempt (web app, and IMAP, POP3, SMTP and ManageSieve via
  Dovecot), web lockouts, signed-in web sessions you can sign out, and an audit log of
  changes made in the admin area.
- **Server logs**: live Postfix, Dovecot and app logs with level and text filters.

Sign-in attempts and the mail log are kept for `ACTIVITY_RETENTION_DAYS` (90 by default).
Postfix logs each message's Subject so the mail log can show it.

### Locked out of the admin area

The app container has a small recovery CLI that works directly on the database, no sign-in needed:

```bash
docker compose exec app node dist/cli.js users                          # list mailboxes and admins
docker compose exec app node dist/cli.js passwd admin@example.com       # prompts for a new password
docker compose exec app node dist/cli.js passwd admin@example.com --generate
docker compose exec app node dist/cli.js logout admin@example.com       # or: logout --all
docker compose exec app node dist/cli.js unlock                         # list lockouts; unlock <email|ip> clears one
```

`passwd` also clears that account's sign-in lockout and signs it out of every web session.
Changes made this way appear in the audit log as "system".

### Optional antivirus

ClamAV needs roughly 3–4 GB of RAM. Enable it with:

```bash
CLAMAV_ENABLED=1 docker compose --profile clamav up -d
```

(and set `CLAMAV_ENABLED=1` in `.env` so restarts keep it on). Without the profile the
antivirus module is not loaded at all.

### Mail clients

Thunderbird and most phones configure themselves from the `autoconfig.<domain>`
record shown in the DNS guide. Manual settings:

| Protocol | Host | Port | Security | Username |
| --- | --- | --- | --- | --- |
| IMAP | mail.example.com | 993 | SSL/TLS | full email address |
| POP3 | mail.example.com | 995 | SSL/TLS | full email address |
| SMTP | mail.example.com | 587 (or 465) | STARTTLS (or SSL/TLS) | full email address |

## Development

No public DNS needed; outbound mail is captured by Mailpit.

```bash
cp .env.example .env            # defaults are fine for dev
docker compose -f docker-compose.dev.yml up --build
```

- Web UI: <https://mail.localhost:8443> (Caddy's local CA; accept the browser warning)
- Mailpit (all outbound mail): <http://localhost:8825>
- Seeded accounts: `admin@example.test` / `password1234` (admin), `alice@example.test` / `password1234`
- Inject inbound mail: `swaks --to alice@example.test --server localhost:2525`
- rspamd UI: <http://localhost:11334> (password `devrspamd`)

The API server and the Vite dev server reload on file changes.

## Layout

```text
docker-compose.yml       production stack
docker-compose.dev.yml   development stack (Mailpit, hot reload, local CA)
docker/                  Postfix, Dovecot, rspamd, Caddy, tls-sync, Postgres init
apps/server              Hono API, IMAP bridge, admin logic (TypeScript)
apps/web                 React + Vite web client
packages/shared          zod schemas shared by server and web
```

## How the pieces fit

- Postfix and Dovecot read domains, mailboxes and aliases straight from PostgreSQL
  (read-only role `mailreader`); the app writes them. Changes are live immediately.
- The app opens mailboxes over IMAP through a Dovecot *master user*, so user passwords
  are never stored by the app.
- Domain creation generates a DKIM key; rspamd signs outgoing mail with it and the DNS
  guide shows the record to publish.
- Caddy obtains certificates; the `tls-sync` sidecar copies them to Postfix/Dovecot and
  reloads Dovecot on renewal.
- Login attempts are rate limited in the app (web), Postfix (`anvil`) and Dovecot
  (auth penalty).
- Postfix and Dovecot write their logs to the `mail-logs` volume (and still to
  `docker compose logs`); the app reads them from there. Dovecot posts every sign-in
  result to the app's internal port 3001, which is never published. Queue actions from
  the admin area reach Postfix through files in the `postfix-ctl` volume, so the app
  needs neither a network port on Postfix nor the Docker socket.

## Backups

Back up the Docker volumes `pgdata` (database), `vmail` (mail storage), `dkim`
(signing keys) and `caddy-data` (certificates).
