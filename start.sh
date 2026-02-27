#!/bin/sh
set -eu

apk update
apk upgrade --no-cache

exec node /app/server.js
