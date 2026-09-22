#!/bin/sh
# Ionnet Mailer — Postfix control channel and log rotation.
#
# The app asks for queue operations by dropping "<id>.req" files into
# $CTL_DIR, a volume shared with the app container only. Each request is one
# line, "<command> [queue-id]"; this loop runs it and answers with "<id>.res":
# a status line ("ok" or "error") followed by the command's output.
# See apps/server/src/activity/postfix-ctl.ts for the other side.
set -u
CTL_DIR=${CTL_DIR:-/var/lib/postfix-ctl}
LOG_FILE=/var/log/mail/postfix.log
MAX_LOG_BYTES=${POSTFIX_LOG_MAX_BYTES:-52428800}
KEEP_ROTATED=4

mkdir -p "$CTL_DIR"
chmod 0700 "$CTL_DIR"
rm -f "$CTL_DIR"/*.req "$CTL_DIR"/*.res "$CTL_DIR"/*.tmp

answer() { # id status output
  printf '%s\n%s' "$2" "$3" > "$CTL_DIR/$1.tmp" && mv -f "$CTL_DIR/$1.tmp" "$CTL_DIR/$1.res"
}

handle() {
  req=$1
  id=$(basename "$req" .req)
  line=$(head -c 200 "$req" | head -n 1)
  rm -f "$req"
  cmd=${line%% *}
  qid=
  [ "$cmd" != "$line" ] && qid=${line#* }

  case "$cmd" in
    retry|hold|release|delete)
      # "ALL" and "-" mean every message / stdin to postsuper; only accept a single id.
      case "$qid" in
        ''|ALL|*[!0-9A-Za-z]*) answer "$id" error "invalid queue id"; return ;;
      esac
      ;;
  esac

  case "$cmd" in
    queue)   out=$(postqueue -j 2>&1) ;;
    flush)   out=$(postqueue -f 2>&1) ;;
    retry)   out=$(postqueue -i "$qid" 2>&1) ;;
    hold)    out=$(postsuper -h "$qid" 2>&1) ;;
    release) out=$(postsuper -H "$qid" 2>&1) ;;
    delete)  out=$(postsuper -d "$qid" 2>&1) ;;
    *)       answer "$id" error "unknown command: $cmd"; return ;;
  esac
  rc=$?

  # postsuper exits 0 even when the message is gone; it just reports zero messages.
  case "$cmd" in
    hold|release|delete)
      case "$out" in
        *": 1 message"*) ;;
        *) answer "$id" error "Message $qid is not in the queue (already delivered or removed?)"; return ;;
      esac
      ;;
  esac

  if [ "$rc" -eq 0 ]; then answer "$id" ok "$out"; else answer "$id" error "$out"; fi
}

rotate_log() {
  [ -f "$LOG_FILE" ] || return 0
  size=$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)
  [ "$size" -gt "$MAX_LOG_BYTES" ] || return 0
  postfix logrotate >/dev/null 2>&1 || return 0
  # Rotated files are gzipped by Postfix; keep the newest few.
  ls -1t "$LOG_FILE".* 2>/dev/null | tail -n +$((KEEP_ROTATED + 1)) | xargs -r rm -f
}

n=0
while :; do
  for req in "$CTL_DIR"/*.req; do
    [ -f "$req" ] && handle "$req"
  done
  n=$((n + 1))
  if [ $((n % 600)) -eq 0 ]; then
    rotate_log
    # Answers the app gave up waiting for.
    find "$CTL_DIR" -name '*.res' -mmin +2 -delete 2>/dev/null
  fi
  sleep 0.5
done
