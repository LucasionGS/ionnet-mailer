#!/bin/sh
# Ionnet Mailer — Postfix entrypoint
set -eu

: "${MAIL_HOSTNAME:?MAIL_HOSTNAME must be set}"
: "${MAIL_DB_PASSWORD:?MAIL_DB_PASSWORD must be set}"
: "${POSTGRES_DB:=ionmailer}"
: "${MAIL_NETWORK_SUBNET:=172.28.0.0/24}"
: "${POSTFIX_RELAYHOST:=}"
: "${POSTFIX_SMTP_TLS_SECURITY_LEVEL:=may}"

# Render SQL map files with credentials (readable by root and postfix only).
mkdir -p /etc/postfix/sql
for f in /etc/postfix/sql.template/*.cf; do
  sed -e "s|@@MAIL_DB_PASSWORD@@|$MAIL_DB_PASSWORD|g" \
      -e "s|@@POSTGRES_DB@@|$POSTGRES_DB|g" "$f" > "/etc/postfix/sql/$(basename "$f")"
done
chown -R root:postfix /etc/postfix/sql
chmod 0640 /etc/postfix/sql/*.cf

postconf -e "myhostname=$MAIL_HOSTNAME" \
           "mynetworks=127.0.0.0/8 [::1]/128 $MAIL_NETWORK_SUBNET" \
           "relayhost=$POSTFIX_RELAYHOST" \
           "smtp_tls_security_level=$POSTFIX_SMTP_TLS_SECURITY_LEVEL"

# Wait for the TLS certificate from the tls-sync sidecar.
i=0
while [ ! -s /certs/tls.crt ] || [ ! -s /certs/tls.key ]; do
  i=$((i+1))
  if [ $i -gt 120 ]; then echo "postfix: timed out waiting for /certs/tls.crt" >&2; exit 1; fi
  [ $i -eq 1 ] && echo "postfix: waiting for TLS certificate in /certs ..."
  sleep 1
done

# Docker DNS and CA bundle inside the (non-chrooted) queue directory, harmless if unused.
mkdir -p /var/spool/postfix/etc
cp -f /etc/resolv.conf /etc/hosts /etc/services /var/spool/postfix/etc/ 2>/dev/null || true

postfix set-permissions >/dev/null 2>&1 || true
postfix check

# The mail log lives on the shared mail-logs volume (the app reads it); mirror
# it to stdout so `docker compose logs postfix` keeps working.
mkdir -p /var/log/mail
touch /var/log/mail/postfix.log
tail -n 0 -F /var/log/mail/postfix.log 2>/dev/null &

# Queue commands from the app, and log rotation.
/usr/local/bin/postfix-ctl.sh &

exec postfix start-fg
