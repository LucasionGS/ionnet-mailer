FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends postfix postfix-pgsql ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/postfix/main.cf /etc/postfix/master.cf
COPY main.cf master.cf header_checks submission_header_checks /etc/postfix/
COPY sql /etc/postfix/sql.template
COPY entrypoint.sh /entrypoint.sh
COPY postfix-ctl.sh /usr/local/bin/postfix-ctl.sh
RUN chmod +x /entrypoint.sh /usr/local/bin/postfix-ctl.sh
EXPOSE 25 465 587 10025
# `postfix status` writes a line to the mail log on every run; asking showq for the queue doesn't.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD postqueue -p >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/entrypoint.sh"]
