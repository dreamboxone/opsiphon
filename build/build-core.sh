#!/bin/sh
#
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 dreamboxone <https://t.me/routekernel1>
# Part of opsiphon - Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
#
# build-core.sh - cross compile the Psiphon core (psiphon-tunnel-core console
# client) for an OpenWrt target.
#
#
# Usage:
#   ./build/build-core.sh                  # default: ipq40xx / arm_cortex-a7_neon-vfpv4
#   ./build/build-core.sh aarch64
#   ./build/build-core.sh mipsel
#
# Requires: git and a Go toolchain matching psiphon-tunnel-core's go.mod
# (currently Go 1.26+). Nothing else - CGO is disabled, the result is a
# static binary with no libc dependency, so it runs on musl OpenWrt as is.

set -e

TARGET="${1:-armv7}"
REPO="${PSIPHON_REPO:-https://github.com/Psiphon-Labs/psiphon-tunnel-core.git}"
REF="${PSIPHON_REF:-master}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${OPSIPHON_WORK:-$ROOT/.build}"
SRC="$WORK/psiphon-tunnel-core"

case "$TARGET" in
	armv7|arm_cortex-a7_neon-vfpv4|ipq40xx|arm)
		GOARCH=arm; GOARM=7; OUTDIR=arm_cortex-a7_neon-vfpv4 ;;
	aarch64|arm64|filogic|mediatek)
		GOARCH=arm64; GOARM=; OUTDIR=aarch64_cortex-a53 ;;
	mipsel|mipsle|ramips|mt7621)
		GOARCH=mipsle; GOARM=; OUTDIR=mipsel_24kc ;;
	mips|ath79)
		GOARCH=mips; GOARM=; OUTDIR=mips_24kc ;;
	x86_64|amd64)
		GOARCH=amd64; GOARM=; OUTDIR=x86_64 ;;
	i386|x86)
		GOARCH=386; GOARM=; OUTDIR=i386_pentium4 ;;
	*)
		echo "unknown target '$TARGET'"
		echo "supported: armv7 aarch64 mipsel mips x86_64 i386"
		exit 1 ;;
esac

command -v go >/dev/null 2>&1 || { echo "go toolchain not found in PATH"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git not found in PATH"; exit 1; }

echo ">>> target        : $TARGET"
echo ">>> GOARCH        : $GOARCH${GOARM:+ (GOARM=$GOARM)}"
echo ">>> openwrt arch  : $OUTDIR"
echo ">>> go            : $(go version)"

mkdir -p "$WORK"
if [ -d "$SRC/.git" ]; then
	echo ">>> updating source"
	git -C "$SRC" fetch --depth 1 origin "$REF"
	git -C "$SRC" checkout -q FETCH_HEAD
else
	echo ">>> cloning psiphon-tunnel-core"
	git clone --depth 1 --branch "$REF" "$REPO" "$SRC"
fi

REV="$(git -C "$SRC" rev-parse --short=10 HEAD)"
echo ">>> core revision : $REV"

OUT="$ROOT/prebuilt/$OUTDIR/psiphon-tunnel-core"
mkdir -p "$(dirname "$OUT")"

# stamp build info so `psiphon-tunnel-core -v` (and the LuCI About box) can
# report which core revision is installed
BI="github.com/Psiphon-Labs/psiphon-tunnel-core/psiphon/common/buildinfo"
LDFLAGS="-s -w"
LDFLAGS="$LDFLAGS -X $BI.buildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LDFLAGS="$LDFLAGS -X $BI.buildRepo=$REPO"
LDFLAGS="$LDFLAGS -X $BI.buildRev=$REV"
LDFLAGS="$LDFLAGS -X $BI.goVersion=$(go env GOVERSION)"

echo ">>> building (this takes a few minutes on first run)"
cd "$SRC"
env GOFLAGS=-mod=vendor \
    GOOS=linux \
    GOARCH="$GOARCH" \
    ${GOARM:+GOARM=$GOARM} \
    CGO_ENABLED=0 \
    go build -trimpath -ldflags="$LDFLAGS" -o "$OUT" ./ConsoleClient

echo "$REV" > "$ROOT/prebuilt/$OUTDIR/core-revision.txt"

echo ">>> done: $OUT"
ls -l "$OUT"
command -v file >/dev/null 2>&1 && file "$OUT" || true
