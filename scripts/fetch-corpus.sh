#!/bin/sh
set -eu

URLS_FILE="${1:-tests/corpus/urls.txt}"
OUT_DIR="${2:-tests/fixtures/corpus}"
INDEX_FILE="${OUT_DIR}/index.tsv"
PRECHECK_HOST="${CORPUS_PRECHECK_HOST:-github.com}"

if [ ! -f "${URLS_FILE}" ]; then
  echo "URLs file not found: ${URLS_FILE}" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not found in PATH" >&2
  exit 1
fi

# Fail fast when command-line DNS/network is unavailable in this runtime.
if ! node -e "require('node:dns').lookup('${PRECHECK_HOST}', (e) => process.exit(e ? 1 : 0))" >/dev/null 2>&1; then
  echo "DNS precheck failed for ${PRECHECK_HOST}. This runtime cannot resolve external hosts." >&2
  echo "Run corpus fetch in a network-enabled shell (outside restricted sandbox) and retry." >&2
  exit 2
fi

mkdir -p "${OUT_DIR}"
rm -f "${OUT_DIR}"/*.html
printf "id\turl\tfile\tstatus\tdetail\n" > "${INDEX_FILE}"

i=0
while IFS= read -r line || [ -n "${line}" ]; do
  url="$(printf "%s" "${line}" \
    | tr -d '\r' \
    | sed '1s/^\xEF\xBB\xBF//' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
    | sed 's/^[-*][[:space:]]*//' \
    | sed 's/[[:space:]]\+#.*$//' \
    | sed 's/[;,][[:space:]]*$//')"
  case "${url}" in
    ""|\#*) continue ;;
  esac

  case "${url}" in
    http://*|https://*) ;;
    *) url="https://${url}" ;;
  esac

  i=$((i + 1))
  id="$(printf "%03d" "${i}")"
  host="$(printf "%s" "${url}" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##; s#[:?&=]#_#g')"
  [ -n "${host}" ] || host="site"
  file="${id}-${host}.html"
  out_path="${OUT_DIR}/${file}"

  err_file="${OUT_DIR}/.${id}.curl.err"
  if curl -fsSL \
    --retry 2 \
    --retry-all-errors \
    --connect-timeout 10 \
    --max-time 30 \
    -H 'Accept: text/html,application/xhtml+xml' \
    -H 'Accept-Language: en-US,en;q=0.9' \
    -A 'ImageFetchCorpus/1.0 (+https://github.com/jtbrough/ImageFetch)' \
    "${url}" \
    -o "${out_path}" \
    2>"${err_file}"; then
    printf "%s\t%s\t%s\tok\t-\n" "${id}" "${url}" "${file}" >> "${INDEX_FILE}"
    rm -f "${err_file}"
    echo "ok   ${url} -> ${file}"
  else
    rc=$?
    detail="$(tr '\n' ' ' < "${err_file}" | sed 's/[[:space:]]\+/ /g; s/^[[:space:]]*//; s/[[:space:]]*$//')"
    rm -f "${err_file}"
    [ -n "${detail}" ] || detail="curl_exit_${rc}"
    rm -f "${out_path}"
    printf "%s\t%s\t%s\tfetch_failed\t%s\n" "${id}" "${url}" "${file}" "${detail}" >> "${INDEX_FILE}"
    echo "fail ${url} (${detail})" >&2
  fi
done < "${URLS_FILE}"

echo "Wrote corpus index: ${INDEX_FILE}"
