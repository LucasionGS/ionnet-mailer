#!/bin/sh
# Ionnet Mailer — rspamd entrypoint (starts as root, rspamd drops to _rspamd)
set -eu
: "${RSPAMD_PASSWORD:?RSPAMD_PASSWORD must be set}"
: "${MAIL_NETWORK_SUBNET:=172.28.0.0/24}"
: "${CLAMAV_ENABLED:=0}"
: "${RSPAMD_DEV_MODE:=0}"

# The compose subnet minus its gateway (the first host address), as CIDRs separated
# by $2 (default a space). Docker's userland proxy forwards some connections (IPv6
# clients when the network is IPv4-only, and host-local ones) from the gateway, so
# trusting the whole subnet would trust arbitrary internet clients. The dev stack sets
# TRUST_DOCKER_GATEWAY=1 so mail can be injected from the host.
trusted_networks() {
  if [ "${TRUST_DOCKER_GATEWAY:-0}" = "1" ]; then echo "$1"; return; fi
  echo "$1" | awk -F'[./]' -v sep="${2:- }" '{
    p = $5; net = (($1 * 256 + $2) * 256 + $3) * 256 + $4
    size = 2 ^ (32 - p); net = net - (net % size); gw = net + 1
    for (b = 32; b > p; b--) {
      blk = 2 ^ (32 - b); sib = gw - (gw % blk)
      sib = (int(sib / blk) % 2 == 0) ? sib + blk : sib - blk
      printf "%s%d.%d.%d.%d/%d", (b < 32 ? sep : ""), int(sib / 16777216) % 256, int(sib / 65536) % 256, int(sib / 256) % 256, sib % 256, b
    }
  }'
}

HASH=$(rspamadm pw -p "$RSPAMD_PASSWORD")

rm -rf /etc/rspamd/local.d /etc/rspamd/override.d
mkdir -p /etc/rspamd/local.d /etc/rspamd/override.d
for f in /etc/rspamd/local.d.template/*; do
  case "$f" in *.template) continue;; esac
  sed -e "s|@@TRUSTED_NETWORKS@@|$(trusted_networks "$MAIL_NETWORK_SUBNET" ", ")|g" \
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
trusted_networks "$MAIL_NETWORK_SUBNET" "
" > /var/lib/rspamd/local_networks.map
echo >> /var/lib/rspamd/local_networks.map
[ -f /var/lib/rspamd/dkim/selectors.map ] || : > /var/lib/rspamd/dkim/selectors.map
chown -R 11333:11333 /var/lib/rspamd /etc/rspamd/local.d /etc/rspamd/override.d
chmod 0750 /var/lib/rspamd/dkim

rspamadm configtest >/dev/null || { echo "rspamd: config test failed" >&2; rspamadm configtest; exit 1; }
exec /usr/bin/rspamd -f -u _rspamd -g _rspamd
