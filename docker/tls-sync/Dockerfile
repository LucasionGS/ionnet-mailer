FROM alpine:3.22
RUN apk add --no-cache inotify-tools openssl
COPY sync.sh /sync.sh
RUN chmod +x /sync.sh
ENTRYPOINT ["/sync.sh"]
