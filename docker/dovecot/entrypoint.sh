#!/bin/sh
# Ionnet Mailer — Dovecot entrypoint
set -eu

: "${DOVECOT_MASTER_PASSWORD:?DOVECOT_MASTER_PASSWORD must be set}"
: "${MAIL_DB_PASSWORD:?MAIL_DB_PASSWORD must be set}"
: "${POSTGRES_DB:=ionmailer}"
: "${MAIL_NETWORK_SUBNET:=172.28.0.0/24}"

mkdir -p /run/dovecot /srv/vmail
chown vmail:vmail /srv/vmail

# The app accepts sign-in events only on a URL carrying this token; it derives
# the same value from the master password (apps/server/src/activity/dovecot-events.ts).
EVENTS_TOKEN=$(printf '%s' "dovecot-events:$DOVECOT_MASTER_PASSWORD" | sha256sum | cut -c1-40)
# Same idea for the doveadm HTTP API (apps/server/src/mail/doveadm.ts).
DOVEADM_PASSWORD=$(printf '%s' "doveadm:$DOVECOT_MASTER_PASSWORD" | sha256sum | cut -c1-40)

# Render the configuration template (secrets come from the environment).
rm -rf /etc/dovecot/conf.d
sed -e "s|@@MAIL_NETWORK_SUBNET@@|$MAIL_NETWORK_SUBNET|g" \
    -e "s|@@POSTGRES_DB@@|$POSTGRES_DB|g" \
    -e "s|@@MAIL_DB_PASSWORD@@|$MAIL_DB_PASSWORD|g" \
    -e "s|@@EVENTS_TOKEN@@|$EVENTS_TOKEN|g" \
    -e "s|@@DOVEADM_PASSWORD@@|$DOVEADM_PASSWORD|g" \
    /etc/dovecot/dovecot.conf.template > /etc/dovecot/dovecot.conf
chmod 0600 /etc/dovecot/dovecot.conf

# Master user file: username "ionnet" with the shared secret from the environment.
umask 077
printf 'ionnet:{PLAIN}%s\n' "$DOVECOT_MASTER_PASSWORD" > /run/dovecot/master-users
chown dovecot:dovecot /run/dovecot/master-users   # the auth process runs as "dovecot"
chmod 0400 /run/dovecot/master-users
umask 022

# Wait for the TLS certificate produced by the tls-sync sidecar.
i=0
while [ ! -s /certs/tls.crt ] || [ ! -s /certs/tls.key ]; do
  i=$((i+1))
  if [ $i -gt 120 ]; then echo "dovecot: timed out waiting for /certs/tls.crt" >&2; exit 1; fi
  [ $i -eq 1 ] && echo "dovecot: waiting for TLS certificate in /certs ..."
  sleep 1
done

# Global 'before' sieve scripts: copy to a writable dir (Dovecot stores the
# compiled .svbin next to the script) and precompile them.
mkdir -p /var/lib/dovecot/sieve/before
rm -f /var/lib/dovecot/sieve/before/*
cp /etc/dovecot/sieve/before/*.sieve /var/lib/dovecot/sieve/before/ 2>/dev/null || true
for s in /var/lib/dovecot/sieve/before/*.sieve; do
  [ -f "$s" ] && sievec "$s"
done
chown -R vmail:vmail /var/lib/dovecot/sieve

doveconf -n > /dev/null   # fail fast on config errors

# The log lives on the shared mail-logs volume; mirror it to stdout.
LOG_FILE=/var/log/mail/dovecot.log
MAX_LOG_BYTES=${DOVECOT_LOG_MAX_BYTES:-52428800}
mkdir -p /var/log/mail
touch "$LOG_FILE"
tail -n 0 -F "$LOG_FILE" 2>/dev/null &

# Reload Dovecot whenever tls-sync installs a renewed certificate, and rotate the log.
(
  last=$(stat -c %Y /certs/tls.crt)
  while sleep 60; do
    now=$(stat -c %Y /certs/tls.crt 2>/dev/null || echo "$last")
    if [ "$now" != "$last" ]; then
      last=$now
      echo "dovecot: certificate changed, reloading"
      doveadm reload || true
    fi
    size=$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$size" -gt "$MAX_LOG_BYTES" ]; then
      mv -f "$LOG_FILE" "$LOG_FILE.1"
      doveadm log reopen || true
    fi
  done
) &

exec dovecot -F
