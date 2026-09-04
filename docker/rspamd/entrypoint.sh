#!/bin/sh
# Ionnet Mailer — rspamd entrypoint (starts as root, rspamd drops to _rspamd)
set -eu
: "${RSPAMD_PASSWORD:?RSPAMD_PASSWORD must be set}"
: "${MAIL_NETWORK_SUBNET:=172.28.0.0/24}"
: "${CLAMAV_ENABLED:=0}"
: "${RSPAMD_DEV_MODE:=0}"

HASH=$(rspamadm pw -p "$RSPAMD_PASSWORD")

rm -rf /etc/rspamd/local.d /etc/rspamd/override.d
mkdir -p /etc/rspamd/local.d /etc/rspamd/override.d
for f in /etc/rspamd/local.d.template/*; do
  case "$f" in *.template) continue;; esac
  sed -e "s|@@MAIL_NETWORK_SUBNET@@|$MAIL_NETWORK_SUBNET|g" \
      -e "s|@@RSPAMD_PASSWORD_HASH@@|$HASH|g" "$f" > "/etc/rspamd/local.d/$(basename "$f")"
done

if [ "$CLAMAV_ENABLED" = "1" ]; then
  echo "rspamd: ClamAV scanning enabled (clamav:3310)"
  cp /etc/rspamd/local.d.template/antivirus.conf.template /etc/rspamd/local.d/antivirus.conf
fi

if [ "$RSPAMD_DEV_MODE" = "1" ]; then
  echo "rspamd: dev mode — disabling RBL lookups and greylisting"
  cp /etc/rspamd/dev-override.d/*.conf /etc/rspamd/override.d/
fi

# Networks whose mail is signed even without SASL (the app container).
mkdir -p /var/lib/rspamd/dkim
echo "$MAIL_NETWORK_SUBNET" > /var/lib/rspamd/local_networks.map
[ -f /var/lib/rspamd/dkim/selectors.map ] || : > /var/lib/rspamd/dkim/selectors.map
chown -R 11333:11333 /var/lib/rspamd /etc/rspamd/local.d /etc/rspamd/override.d
chmod 0750 /var/lib/rspamd/dkim

rspamadm configtest >/dev/null || { echo "rspamd: config test failed" >&2; rspamadm configtest; exit 1; }
exec /usr/bin/rspamd -f -u _rspamd -g _rspamd
