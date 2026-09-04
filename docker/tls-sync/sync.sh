#!/bin/sh
# Ionnet Mailer — tls-sync
# Copies the certificate Caddy obtained for MAIL_HOSTNAME into the shared
# /certs volume used by Postfix and Dovecot. Postfix picks the new files up on
# its next smtpd process; Dovecot's entrypoint watches the file and reloads.
set -eu
: "${MAIL_HOSTNAME:?MAIL_HOSTNAME must be set}"
CADDY_CERTS=${CADDY_CERTS:-/caddy/caddy/certificates}
OUT=/certs
mkdir -p "$OUT"

log() { echo "tls-sync: $*"; }

find_cert() {
  # Prefer Let's Encrypt, then any issuer directory, then Caddy's local CA.
  for d in "$CADDY_CERTS"/acme-v02.api.letsencrypt.org-directory "$CADDY_CERTS"/* ; do
    [ -f "$d/$MAIL_HOSTNAME/$MAIL_HOSTNAME.crt" ] && { echo "$d/$MAIL_HOSTNAME"; return 0; }
  done
  return 1
}

install_cert() {
  src=$1
  if [ -f "$OUT/tls.crt" ] && cmp -s "$src/$MAIL_HOSTNAME.crt" "$OUT/tls.crt"; then
    return 1
  fi
  umask 077
  cp "$src/$MAIL_HOSTNAME.crt" "$OUT/tls.crt.tmp"
  cp "$src/$MAIL_HOSTNAME.key" "$OUT/tls.key.tmp"
  chmod 0600 "$OUT/tls.crt.tmp" "$OUT/tls.key.tmp"
  mv -f "$OUT/tls.key.tmp" "$OUT/tls.key"
  mv -f "$OUT/tls.crt.tmp" "$OUT/tls.crt"
  chmod 0644 "$OUT/tls.crt"
  log "installed certificate from $src ($(openssl x509 -in "$OUT/tls.crt" -noout -enddate 2>/dev/null))"
  return 0
}

# 1. Bootstrap: if nothing is installed yet, generate a temporary self-signed
#    certificate so Postfix and Dovecot can start immediately.
if [ ! -s "$OUT/tls.crt" ]; then
  if src=$(find_cert); then
    install_cert "$src" || true
  else
    log "no Caddy certificate yet; generating temporary self-signed certificate for $MAIL_HOSTNAME"
    umask 077
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$MAIL_HOSTNAME" \
      -keyout "$OUT/tls.key" -out "$OUT/tls.crt" >/dev/null 2>&1
    chmod 0644 "$OUT/tls.crt"
    touch "$OUT/.self-signed"
  fi
fi

# 2. Watch Caddy's storage for new/renewed certificates. inotify catches
#    renewals; the periodic poll covers edge cases (missed events, restarts).
#    /caddy is mounted read-only and the certificates directory may not exist
#    yet, so watch the volume root.
WATCH_DIR=/caddy
while true; do
  if src=$(find_cert); then
    if install_cert "$src"; then
      rm -f "$OUT/.self-signed"
    fi
  fi
  inotifywait -q -r -t 300 -e close_write -e moved_to -e create "$WATCH_DIR" >/dev/null 2>&1 || true
  sleep 2
done
