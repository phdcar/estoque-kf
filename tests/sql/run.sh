#!/bin/bash
# Testa o schema.sql num Postgres local com imitações do Supabase.
set -e
D=$(mktemp -d)
PG=/usr/lib/postgresql/16/bin
chown postgres "$D" 2>/dev/null || true
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PG/initdb -D $D/db -A trust -U postgres" >/dev/null
run "$PG/pg_ctl -D $D/db -o '-p 54329 -k $D' -l $D/log start" >/dev/null
trap 'run "$PG/pg_ctl -D $D/db stop -m fast" >/dev/null' EXIT
sleep 1
P="psql -h $D -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database t" >/dev/null
DIR=$(cd "$(dirname "$0")" && pwd)
$P -d t -f "$DIR/stubs.sql" >/dev/null
$P -d t -f "$DIR/../../supabase/schema.sql" >/dev/null
$P -d t -f "$DIR/../../supabase/schema.sql" >/dev/null   # rodar 2x não pode dar erro
$P -d t -f "$DIR/stubs_avisos.sql" >/dev/null
$P -d t -f "$DIR/../../supabase/avisos-email.sql" >/dev/null
$P -d t -f "$DIR/../../supabase/avisos-email.sql" >/dev/null   # rodar 2x não pode dar erro
$P -d t -f "$DIR/../../supabase/push.sql" >/dev/null
$P -d t -f "$DIR/../../supabase/push.sql" >/dev/null
$P -d t -f "$DIR/../../supabase/avisos-email.sql" >/dev/null
OUT=$($P -d t -t -A -f "$DIR/rls_test.sql" 2>&1) || { echo "$OUT"; exit 1; }
OUT2=$($P -d t -t -A -f "$DIR/avisos_test.sql" 2>&1) || { echo "$OUT"; echo "$OUT2"; exit 1; }
OUT="$OUT
$OUT2"
if echo "$OUT" | grep -qx f; then echo "$OUT"; echo "FALHOU: alguma verificação deu falso"; exit 1; fi
echo "SQL OK: $(echo "$OUT" | grep -cx t) verificações verdadeiras, $(echo "$OUT" | grep -c "OK (bloqueado)") bloqueios confirmados"
