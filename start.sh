#!/bin/sh
set -eu

if [ "${APK_UPGRADE_ON_START:-1}" = "1" ]; then
  apk update
  apk upgrade --no-cache
fi

exec node /app/server.js
