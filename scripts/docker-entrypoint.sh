#!/bin/sh
set -eu
node dist/packages/storage/src/migrate.js
exec node dist/apps/bot/src/main.js
