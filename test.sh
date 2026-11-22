#!/usr/bin/env bash
# Runs all tests and prints one line per check:
#   1. Go tests: generator (golden files), checks, previews, server, settings. No network.
#   2. Editor model tests in Node (source/webtest/).
#   3. End-to-end: builds the program, starts it without a browser on a free port with an
#      empty temp settings folder, and checks the page, the token and host checks, and
#      new / save / open / preview / export / settings through the real API.
# Only 127.0.0.1 is contacted. Exit code 1 if anything failed.
# Usage: ./test.sh   (needs: go, node 22+, curl)
set -uo pipefail
cd "$(dirname "$0")"
command -v go > /dev/null || { echo "go not found in PATH (is Go installed, and its bin folder in PATH?)"; exit 1; }

pass=0 fail=0
ok()  { printf '  \033[32m✔\033[0m %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '  \033[31m✘\033[0m %s   (%s)\n' "$1" "$2"; fail=$((fail + 1)); }
# check NAME CMD...: passes when CMD succeeds
check() { local name=$1; shift; if out=$("$@" 2>&1); then ok "$name"; else out=$(tail -1 <<< "$out"); bad "$name" "${out:-check failed}"; fi; }

tmp=$(mktemp -d)
pid=""
trap '[ -n "$pid" ] && kill $pid 2>/dev/null; wait $pid 2>/dev/null; rm -rf "$tmp"' EXIT

# ---------------------------------------------------------------- 1. Go tests
echo "Go tests"
(cd source && go test -count=1 -v ./...) > "$tmp/go.log" 2>&1
while read -r status name _; do
  [ "$status" = "PASS:" ] && ok "$name" || bad "$name" "see: cd source && go test -run $name -v"
done < <(sed -n 's/^--- \(PASS:\|FAIL:\) /\1 /p' "$tmp/go.log")
if grep -q -E '^(FAIL|panic:|.*\[build failed\])' "$tmp/go.log" && ! grep -q '^--- FAIL' "$tmp/go.log"; then
  bad "go test" "$(grep -m1 -E 'FAIL|panic|cannot|undefined' "$tmp/go.log")"
fi

# ---------------------------------------------------------------- 2. editor model
echo "Editor model (node)"
if command -v node > /dev/null; then
  node --test --test-reporter=tap source/webtest/*.test.mjs > "$tmp/node.log" 2>&1
  while read -r line; do
    case "$line" in
      "ok "*)     ok "${line#ok * - }" ;;
      "not ok "*) bad "${line#not ok * - }" "see: node --test source/webtest/" ;;
    esac
  done < <(grep -E '^(ok|not ok) [0-9]+ - ' "$tmp/node.log")
  grep -q -E '^(ok|not ok) ' "$tmp/node.log" || bad "node tests" "$(tail -1 "$tmp/node.log")"
else
  bad "editor model" "node not found in PATH"
fi

# ---------------------------------------------------------------- 3. end-to-end
echo "End-to-end (real program, temp settings, 127.0.0.1 only)"
bin=$tmp/wa-sheet-gen
if ! (cd source && go build -o "$bin" .) 2> "$tmp/build.log"; then
  bad "build" "$(tail -1 "$tmp/build.log")"
  echo "---"; echo "$pass passed, $fail failed"; exit 1
fi
ok "build"

version=$(sed -n 's/^const appVersion = "\(.*\)"$/\1/p' source/version.go)
check "--version shows $version" grep -q "wa-sheet-gen $version" <<< "$("$bin" --version)"

XDG_CONFIG_HOME=$tmp/cfg "$bin" --no-browser > "$tmp/serve.log" 2>&1 &
pid=$!
url=""
for _ in $(seq 50); do
  url=$(grep -o 'http://127\.0\.0\.1:[0-9]*/?t=[0-9a-f]*' "$tmp/serve.log" || true)
  [ -n "$url" ] && break
  sleep 0.1
done
if [ -n "$url" ]; then ok "server starts"; else bad "server starts" "$(tail -1 "$tmp/serve.log")"; exit 1; fi
base=${url%%/?t=*}
token=${url##*t=}

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }              # HTTP status of a request
api()  { curl -s -H "X-Token: $token" -H "Content-Type: application/json" "$@"; }

check "editor page loads (200)" test "$(code "$base/")" = 200
check "API without token is refused (401)" test "$(code "$base/api/info")" = 401
check "API with token works (200)" test "$(code -H "X-Token: $token" "$base/api/info")" = 200
check "API reports version $version" grep -q "\"$version\"" <<< "$(api "$base/api/info")"
check "foreign Host header is refused (403)" test "$(code -H "Host: evil.example" "$base/")" = 403

project=$(api "$base/api/project/new")
check "new sheet has the name field" grep -q '"name":"name"' <<< "$project"
sheet=$tmp/sheets/my-sheet
save()     { api -d "{\"folder\":\"$sheet\",\"project\":$project}" "$base/api/project/save" > /dev/null && test -f "$sheet/project.json"; }
settings() { api -X PUT -d '{"canvasTheme":"light"}' "$base/api/settings" > /dev/null && grep -q light "$tmp/cfg/wa-sheet-gen/settings.json"; }
check "save writes project.json" save
check "open reads it back" grep -q '"sheetName":"new-sheet"' <<< "$(api -d "{\"folder\":\"$sheet\"}" "$base/api/project/open")"
check "preview shows sample data" grep -q 'Aria Windwalker' <<< "$(api -d "{\"project\":$project}" "$base/api/preview")"
check "export is accepted" grep -q '"files"' <<< "$(api -d "{\"folder\":\"$sheet\",\"project\":$project}" "$base/api/export")"
for f in approved.css style.css import-to-wa.yml basic-sheet.html.twig edit-form.html.twig; do
  check "export wrote $f" test -s "$sheet/$f"
done
check "YAML starts with fields:" test "$(head -1 "$sheet/import-to-wa.yml")" = "fields:"
check "export with errors is refused (422)" test "$(code -H "X-Token: $token" -d "{\"folder\":\"$sheet\",\"project\":${project/new-sheet/Bad Name}}" "$base/api/export")" = 422
check "settings are saved to a file" settings
check "settings are read back" grep -q '"canvasTheme": "light"' <<< "$(api "$base/api/settings")"
autosave() { api -X PUT -d "{\"folder\":\"\",\"project\":$project,\"at\":1}" "$base/api/autosave" > /dev/null && test -s "$tmp/cfg/wa-sheet-gen/autosave.json"; }
check "autosave is written to a file" autosave
check "autosave is read back" grep -q '"sheetName":"new-sheet"' <<< "$(api "$base/api/autosave")"
check "autosave is deleted after saving" bash -c "curl -s -X DELETE -H 'X-Token: $token' '$base/api/autosave' > /dev/null && test ! -e '$tmp/cfg/wa-sheet-gen/autosave.json'"

kill -TERM "$pid" 2>/dev/null
wait "$pid" 2>/dev/null
check "server stops" bash -c "! kill -0 $pid 2>/dev/null"
pid=""

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
