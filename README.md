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
mailboxes and aliases at any time; each domain has its own DNS guide.

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

## Backups

Back up the Docker volumes `pgdata` (database), `vmail` (mail storage), `dkim`
(signing keys) and `caddy-data` (certificates).
