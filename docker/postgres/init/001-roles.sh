#!/bin/bash
# Creates the read-only role used by Postfix and Dovecot. Runs once on first boot.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mailreader') THEN
      CREATE ROLE mailreader LOGIN PASSWORD '${MAIL_DB_PASSWORD}';
    END IF;
  END
  \$\$;
  GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO mailreader;
  GRANT USAGE ON SCHEMA public TO mailreader;
  -- Tables are created later by the app's migrations; grant SELECT on them as they appear.
  ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public GRANT SELECT ON TABLES TO mailreader;
SQL
