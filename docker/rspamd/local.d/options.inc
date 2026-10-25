# Trust the compose network, minus its gateway, as "local" (affects DKIM sign_local, whitelisting).
local_addrs = [127.0.0.0/8, ::1, @@TRUSTED_NETWORKS@@];
dns {
  timeout = 4s;
  retransmits = 3;
}
