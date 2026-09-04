# Runs before the user's own scripts: file rspamd-flagged spam into Junk.
require ["fileinto", "mailbox"];
if header :is "X-Spam" "Yes" {
  fileinto :create "Junk";
  stop;
}
