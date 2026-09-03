#!/bin/sh
#
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 dreamboxone <https://t.me/routekernel1>
# Part of opsiphon - Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
#
# build-apk.sh - build installable OpenWrt 25.12 .apk packages for opsiphon
# and luci-app-opsiphon, without running the OpenWrt make system.
#
#
# Why this exists: neither package compiles anything (the Psiphon core is a
# prebuilt static Go binary, the LuCI app is plain JS/JSON), so the only thing
# the SDK is really needed for is the packaging step. This script performs
# exactly the steps include/package-pack.mk performs for APK targets - file
# list, conffiles + checksums, install/upgrade/deinstall scripts - and then
# calls `apk mkpkg`. It therefore works on hosts where the full OpenWrt build
# system refuses to run (case-insensitive filesystem, missing ncurses, ...).
#
# Usage:
#   ./build/build-apk.sh [openwrt-arch] [path-to-apk-binary]
#
# The apk binary is taken from any OpenWrt 25.12 SDK:
#   <sdk>/staging_dir/host/bin/apk
# It is auto-detected under $HOME if not given.

set -e

# Package ownership and permissions must be root:root with sane modes. The
# build tree may live on a filesystem that cannot represent them (a mounted
# Windows folder, for example), so run the whole script under fakeroot, where
# chown/chmod are virtualised and picked up by `apk mkpkg`.
if [ "$(id -u)" != "0" ] && [ -z "$FAKEROOTKEY" ]; then
	FAKEROOT="$(command -v fakeroot || true)"
	if [ -n "$FAKEROOT" ]; then
		exec "$FAKEROOT" -- "$0" "$@"
	fi
	echo "warning: fakeroot not found - package file ownership may be wrong" >&2
fi

ARCH="${1:-arm_cortex-a7_neon-vfpv4}"
APK="${2:-$APK_BIN}"

VERSION=1.0.0
RELEASE=3
PKGVER="$VERSION-r$RELEASE"
LICENSE="GPL-3.0-only"
URL="https://github.com/dreamboxone/opsiphon"
MAINTAINER="routekernel <https://t.me/routekernel1>"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The staging tree must live on a real Linux filesystem: package files have to
# end up root:root with proper modes, which a mounted Windows folder cannot
# represent (even under fakeroot). Override with OPSIPHON_WORK if needed.
WORK="${OPSIPHON_WORK:-${TMPDIR:-/tmp}/opsiphon-apk-build}"
DIST="$ROOT/dist"

if [ -z "$APK" ]; then
	APK="$(find "$HOME" -maxdepth 5 -path '*/staging_dir/host/bin/apk' -type f 2>/dev/null | head -1)"
fi
[ -n "$APK" ] && [ -x "$APK" ] || {
	echo "apk tool not found."
	echo "pass it explicitly:  $0 $ARCH /path/to/openwrt-sdk/staging_dir/host/bin/apk"
	exit 1
}

CORE="$ROOT/prebuilt/$ARCH/psiphon-tunnel-core"
[ -f "$CORE" ] || { echo "missing core binary: $CORE (run build/build-core.sh)"; exit 1; }

echo ">>> apk tool : $APK"
echo ">>> arch     : $ARCH"
echo ">>> version  : $PKGVER"

rm -rf "$WORK"
mkdir -p "$WORK" "$DIST"

sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	else
		openssl dgst -sha256 -r "$1" | cut -d' ' -f1
	fi
}

# finalize <name> <arch> <depends> <description>
#   expects $WORK/<name>/ populated with the installed file tree,
#   optional $WORK/<name>.conffiles, $WORK/<name>.postinst, $WORK/<name>.prerm
finalize() {
	name="$1"; arch="$2"; deps="$3"; desc="$4"
	idir="$WORK/$name"
	adir="$WORK/admin-$name"
	mkdir -p "$idir/lib/apk/packages" "$adir"

	# root:root, dirs 0755, data 0644, programs 0755
	find "$idir" -type d -exec chmod 0755 {} +
	find "$idir" -type f -exec chmod 0644 {} +
	for x in usr/bin/psiphon-tunnel-core \
	         etc/init.d/opsiphon \
	         usr/libexec/opsiphon-mkconfig \
	         usr/libexec/opsiphon-notices \
	         usr/libexec/opsiphon-stat \
	         usr/libexec/rpcd/luci.opsiphon; do
		[ -f "$idir/$x" ] && chmod 0755 "$idir/$x"
	done
	chown -R 0:0 "$idir"

	# file list (built outside the tree so it does not list itself)
	( cd "$idir" && find . -type f -o -type l ) | sed 's|^\.||' | sort > "$WORK/$name.list"
	mv "$WORK/$name.list" "$idir/lib/apk/packages/$name.list"

	# conffiles + static checksums
	if [ -f "$WORK/$name.conffiles" ]; then
		cp "$WORK/$name.conffiles" "$idir/lib/apk/packages/$name.conffiles"
		: > "$idir/lib/apk/packages/$name.conffiles_static"
		while read -r file; do
			[ -n "$file" ] || continue
			[ -f "$idir$file" ] || continue
			echo "$file $(sha256 "$idir$file")" \
				>> "$idir/lib/apk/packages/$name.conffiles_static"
		done < "$WORK/$name.conffiles"
	fi

	# post-install (same preamble OpenWrt generates)
	{
		echo "#!/bin/sh"
		echo "[ \"\${IPKG_NO_SCRIPT}\" = \"1\" ] && exit 0"
		echo "[ -s \"\${IPKG_INSTROOT}/lib/functions.sh\" ] || exit 0"
		echo ". \${IPKG_INSTROOT}/lib/functions.sh"
		echo 'export root="${IPKG_INSTROOT}"'
		echo "export pkgname=\"$name\""
		echo "add_group_and_user"
		echo "default_postinst"
		[ -f "$WORK/$name.postinst" ] && sed '/^[[:space:]]*#!/d' "$WORK/$name.postinst"
	} > "$adir/post-install"

	{
		echo "#!/bin/sh"
		echo 'export PKG_UPGRADE=1'
		sed '/^[[:space:]]*#!/d' "$adir/post-install"
	} > "$adir/post-upgrade"

	{
		echo "#!/bin/sh"
		echo "[ -s \"\${IPKG_INSTROOT}/lib/functions.sh\" ] || exit 0"
		echo ". \${IPKG_INSTROOT}/lib/functions.sh"
		echo 'export root="${IPKG_INSTROOT}"'
		echo "export pkgname=\"$name\""
		echo "default_prerm"
		[ -f "$WORK/$name.prerm" ] && sed '/^[[:space:]]*#!/d' "$WORK/$name.prerm"
	} > "$adir/pre-deinstall"

	chmod 755 "$adir"/post-install "$adir"/post-upgrade "$adir"/pre-deinstall

	out="$DIST/$name-$PKGVER.apk"
	rm -f "$out"

	"$APK" mkpkg \
		--info "name:$name" \
		--info "version:$PKGVER" \
		--info "description:$desc" \
		--info "arch:$arch" \
		--info "license:$LICENSE" \
		--info "origin:$name" \
		--info "url:$URL" \
		--info "maintainer:$MAINTAINER" \
		--info "depends:$deps" \
		--script "post-install:$adir/post-install" \
		--script "post-upgrade:$adir/post-upgrade" \
		--script "pre-deinstall:$adir/pre-deinstall" \
		--files "$idir" \
		--output "$out"

	echo ">>> built $(basename "$out") ($(du -h "$out" | cut -f1))"
}

# ------------------------------------------------------------------ opsiphon
F="$ROOT/package/opsiphon/files"
I="$WORK/opsiphon"
install -d "$I/usr/bin" "$I/etc/config" "$I/etc/init.d" "$I/usr/libexec/rpcd" "$I/etc/opsiphon/data"
install -m 0755 "$CORE"                  "$I/usr/bin/psiphon-tunnel-core"
install -m 0644 "$F/opsiphon.config"     "$I/etc/config/opsiphon"
install -m 0755 "$F/opsiphon.init"       "$I/etc/init.d/opsiphon"
install -m 0755 "$F/opsiphon-mkconfig"   "$I/usr/libexec/opsiphon-mkconfig"
install -m 0755 "$F/opsiphon-notices"    "$I/usr/libexec/opsiphon-notices"
install -m 0755 "$F/opsiphon-stat"       "$I/usr/libexec/opsiphon-stat"
install -m 0755 "$F/luci.opsiphon"       "$I/usr/libexec/rpcd/luci.opsiphon"

echo "/etc/config/opsiphon" > "$WORK/opsiphon.conffiles"

cat > "$WORK/opsiphon.postinst" <<'EOF'
mkdir -p /etc/opsiphon/data
/etc/init.d/rpcd reload >/dev/null 2>&1
exit 0
EOF

cat > "$WORK/opsiphon.prerm" <<'EOF'
/etc/init.d/opsiphon stop >/dev/null 2>&1
/etc/init.d/opsiphon disable >/dev/null 2>&1
exit 0
EOF

finalize opsiphon "$ARCH" "jshn libubox" \
	"Psiphon circumvention client for OpenWrt (psiphon-tunnel-core) with procd service, UCI config, SOCKS5/HTTP proxies, egress country selection and live status collector."

# ------------------------------------------------------- luci-app-opsiphon
L="$ROOT/package/luci-app-opsiphon/root"
I="$WORK/luci-app-opsiphon"
install -d "$I/www/luci-static/resources/view/opsiphon" \
           "$I/usr/share/luci/menu.d" "$I/usr/share/rpcd/acl.d"
install -m 0644 "$L/www/luci-static/resources/view/opsiphon/overview.js" \
	"$I/www/luci-static/resources/view/opsiphon/overview.js"
install -m 0644 "$L/www/luci-static/resources/view/opsiphon/logo.png" \
	"$I/www/luci-static/resources/view/opsiphon/logo.png"
install -m 0644 "$L/usr/share/luci/menu.d/luci-app-opsiphon.json" \
	"$I/usr/share/luci/menu.d/luci-app-opsiphon.json"
install -m 0644 "$L/usr/share/rpcd/acl.d/luci-app-opsiphon.json" \
	"$I/usr/share/rpcd/acl.d/luci-app-opsiphon.json"

cat > "$WORK/luci-app-opsiphon.postinst" <<'EOF'
rm -f /tmp/luci-indexcache* 2>/dev/null
rm -rf /tmp/luci-modulecache 2>/dev/null
/etc/init.d/rpcd reload >/dev/null 2>&1
/etc/init.d/uhttpd restart >/dev/null 2>&1
exit 0
EOF

finalize luci-app-opsiphon noarch "opsiphon luci-base" \
	"LuCI web interface for Opsiphon: connect/disconnect, live tunnel status, egress country, traffic statistics, boot autostart and the Psiphon notice log."

echo
echo ">>> packages in $DIST"
ls -l "$DIST"/*.apk
