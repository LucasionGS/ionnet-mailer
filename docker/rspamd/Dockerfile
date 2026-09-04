FROM rspamd/rspamd:4.0
USER root
COPY local.d /etc/rspamd/local.d.template
COPY dev-override.d /etc/rspamd/dev-override.d
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /var/lib/rspamd/dkim && chown -R 11333:11333 /var/lib/rspamd
EXPOSE 11332 11334
ENTRYPOINT ["/entrypoint.sh"]
