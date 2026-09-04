#!/bin/sh
#
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 dreamboxone <https://t.me/routekernel1>
# Part of opsiphon - Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
#
# install-manual.sh - install Opsiphon without building a package.
#
#
# Two ways to use it:
#
#   1) From your workstation, push everything to the router over SSH:
#        ./install-manual.sh root@192.168.1.1 [openwrt-arch]
#
#   2) On the router itself, after copying this repository there:
#        ./install-manual.sh
#
# It installs exactly the same files the .ipk/.apk would install.

set -e

ARCH_DEFAULT=arm_cortex-a7_neon-vfpv4

if [ -n "$1" ] && [ "$1" != "--local" ]; then
	TARGET="$1"
	ARCH="${2:-$ARCH_DEFAULT}"
	ROOT="$(cd "$(dirname "$0")" && pwd)"

	[ -f "$ROOT/prebuilt/$ARCH/psiphon-tunnel-core" ] || {
		echo "missing prebuilt core for $ARCH - run build/build-core.sh first"; exit 1; }

	echo ">>> packing"
	TMPTAR="$(mktemp -t opsiphon-XXXXXX.tar.gz)"
	tar -czf "$TMPTAR" -C "$ROOT" \
		package/opsiphon/files \
		package/luci-app-opsiphon/root \
		"prebuilt/$ARCH/psiphon-tunnel-core" \
		"prebuilt/$ARCH/core-revision.txt" \
		install-manual.sh

	echo ">>> copying to $TARGET"
	scp "$TMPTAR" "$TARGET:/tmp/opsiphon.tar.gz"
	rm -f "$TMPTAR"

	echo ">>> installing on $TARGET"
	ssh "$TARGET" "set -e; rm -rf /tmp/opsiphon-install; mkdir -p /tmp/opsiphon-install; \
		tar -xzf /tmp/opsiphon.tar.gz -C /tmp/opsiphon-install; \
		cd /tmp/opsiphon-install; sh install-manual.sh --local $ARCH; \
		rm -rf /tmp/opsiphon-install /tmp/opsiphon.tar.gz"
	echo ">>> done - open LuCI: Services -> Psiphon and press Connect"
	exit 0
fi

# ---------------------------------------------------------------- local part
ARCH="${2:-$ARCH_DEFAULT}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
F="$ROOT/package/opsiphon/files"
L="$ROOT/package/luci-app-opsiphon/root"
CORE="$ROOT/prebuilt/$ARCH/psiphon-tunnel-core"

[ -f "$CORE" ] || { echo "missing $CORE"; exit 1; }

echo ">>> installing core binary"
install -d /usr/bin
install -m 0755 "$CORE" /usr/bin/psiphon-tunnel-core
REV="$(dirname "$CORE")/core-revision.txt"
if [ -s "$REV" ]; then
	install -d /etc/opsiphon
	install -m 0644 "$REV" /etc/opsiphon/core-revision
fi

echo ">>> installing service"
install -d /etc/config /etc/init.d /usr/libexec /usr/libexec/rpcd /etc/opsiphon/data
[ -f /etc/config/opsiphon ] || install -m 0600 "$F/opsiphon.config" /etc/config/opsiphon
install -m 0755 "$F/opsiphon.init"     /etc/init.d/opsiphon
install -m 0755 "$F/opsiphon-mkconfig" /usr/libexec/opsiphon-mkconfig
install -m 0755 "$F/opsiphon-notices"  /usr/libexec/opsiphon-notices
install -m 0755 "$F/opsiphon-stat"     /usr/libexec/opsiphon-stat
install -m 0755 "$F/opsiphon-usage"    /usr/libexec/opsiphon-usage
install -m 0755 "$F/opsiphon-rules"    /usr/libexec/opsiphon-rules
install -m 0755 "$F/opsiphon-passwall" /usr/libexec/opsiphon-passwall
install -m 0755 "$F/luci.opsiphon"     /usr/libexec/rpcd/luci.opsiphon

echo ">>> installing LuCI app"
install -d /www/luci-static/resources/view/opsiphon /usr/share/luci/menu.d /usr/share/rpcd/acl.d
install -m 0644 "$L/www/luci-static/resources/view/opsiphon/overview.js" \
	/www/luci-static/resources/view/opsiphon/overview.js
install -m 0644 "$L/www/luci-static/resources/view/opsiphon/logo.png" \
	/www/luci-static/resources/view/opsiphon/logo.png
install -m 0644 "$L/usr/share/luci/menu.d/luci-app-opsiphon.json" \
	/usr/share/luci/menu.d/luci-app-opsiphon.json
install -m 0644 "$L/usr/share/rpcd/acl.d/luci-app-opsiphon.json" \
	/usr/share/rpcd/acl.d/luci-app-opsiphon.json

echo ">>> refreshing services"
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf /tmp/luci-modulecache 2>/dev/null || true
/etc/init.d/rpcd reload  >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
/etc/init.d/opsiphon enable >/dev/null 2>&1 || true

echo
echo ">>> installed. status:"
/usr/libexec/opsiphon-stat || true
echo
echo ">>> LuCI: Services -> Psiphon   (press Connect to start the tunnel)"
