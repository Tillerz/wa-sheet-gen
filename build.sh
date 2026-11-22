#!/usr/bin/env bash
# Builds portable binaries into dist/<platform>/ (one folder per platform, nothing to install).
# Usage: ./build.sh            all platforms, plus release archives and SHA256SUMS.txt
#        ./build.sh windows    only the Windows build (quick, for trying it out)
#        ./build.sh linux      only the Linux build
set -euo pipefail
cd "$(dirname "$0")"
command -v go > /dev/null || { echo "go not found in PATH (is Go installed, and its bin folder in PATH?)"; exit 1; }
gofmt -l source | (! grep .) || { echo "gofmt: run 'gofmt -w source' first"; exit 1; }
(cd source && go vet ./... && go test ./...)

build() { # os arch outdir exe
  local dir="dist/$3"
  mkdir -p "$dir"
  (cd source && GOOS=$1 GOARCH=$2 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "../$dir/$4" .)
  cp -f README.md "$dir/"
  if [ -f LICENSE ]; then cp -f LICENSE "$dir/"; fi
  echo "built $dir/$4 ($(du -h "$dir/$4" | cut -f1))"
}

case "${1:-all}" in
  windows) build windows amd64 wa-sheet-gen-windows-amd64 wa-sheet-gen.exe ;;
  linux)   build linux   amd64 wa-sheet-gen-linux-amd64   wa-sheet-gen ;;
  all)
    build linux   amd64 wa-sheet-gen-linux-amd64   wa-sheet-gen
    build windows amd64 wa-sheet-gen-windows-amd64 wa-sheet-gen.exe
    build darwin  arm64 wa-sheet-gen-macos-arm64   wa-sheet-gen
    build darwin  amd64 wa-sheet-gen-macos-amd64   wa-sheet-gen

    # Release archives: dist/wa-sheet-gen-v<version>-<platform>.zip|.tar.gz + SHA256SUMS.txt
    version=$(sed -n 's/^const appVersion = "\(.*\)"$/\1/p' source/version.go)
    [ -n "$version" ] || { echo "no appVersion in source/version.go"; exit 1; }
    rm -f dist/*.zip dist/*.tar.gz dist/SHA256SUMS.txt
    (
      cd dist
      zip -qr "wa-sheet-gen-v$version-windows-amd64.zip" wa-sheet-gen-windows-amd64
      for p in linux-amd64 macos-arm64 macos-amd64; do
        tar -czf "wa-sheet-gen-v$version-$p.tar.gz" "wa-sheet-gen-$p"
      done
      sha256sum *.zip *.tar.gz > SHA256SUMS.txt
    )
    echo "packed v$version:"; ls -1 dist/*.zip dist/*.tar.gz dist/SHA256SUMS.txt
    ;;
  *) echo "usage: ./build.sh [all|windows|linux]"; exit 1 ;;
esac
# The program code is in source/; the editor (source/web/) is embedded in the binary.
