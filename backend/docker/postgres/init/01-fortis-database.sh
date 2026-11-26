#!/bin/sh
# Runs once, on the first start of the local PostgreSQL container (empty volume).
# Creates the application database and its owner. The owner has CREATEROLE but
# not SUPERUSER, like the owner account Neon gives you, so `npm run db:migrate`
# behaves locally as it does in the cloud.
#
# Values arrive as psql variables and are quoted by format(%I / %L) inside
# PostgreSQL, so nothing is spliced into SQL text by the shell.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner="$FORTIS_MIGRATION_USER" \
  -v owner_password="$FORTIS_MIGRATION_PASSWORD" \
  -v db="$FORTIS_DB_NAME" <<'EOSQL'
SELECT pg_catalog.format('CREATE ROLE %I LOGIN CREATEROLE PASSWORD %L', :'owner', :'owner_password') \gexec
SELECT pg_catalog.format('CREATE DATABASE %I OWNER %I', :'db', :'owner') \gexec
EOSQL
