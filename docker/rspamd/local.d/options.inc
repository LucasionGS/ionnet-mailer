# Trust the compose network as "local" (affects DKIM sign_local, whitelisting).
local_addrs = [127.0.0.0/8, ::1, @@MAIL_NETWORK_SUBNET@@];
dns {
  timeout = 4s;
  retransmits = 3;
}
