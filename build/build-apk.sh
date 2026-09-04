#!/bin/sh
#
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 dreamboxone <https://t.me/routekernel1>
# Part of opsiphon - Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
#
# build-apk.sh - build installable OpenWrt 25.12 .apk packages for opsiphon
# and luci-app-opsiphon, without running the OpenWrt make system.
#
# For OpenWrt 23.05 and 24.10, which use opkg rather than apk, use the
# sibling script build-ipk.sh instead. Both take their file lists from
# packages.inc.sh, so the two formats always ship the same tree.
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

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/build/packages.inc.sh"

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

	fix_modes "$idir"

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

stage_opsiphon "$WORK" "$ROOT" "$CORE"
finalize opsiphon "$ARCH" "$OPSIPHON_DEPENDS" "$OPSIPHON_DESC"

stage_luci "$WORK" "$ROOT"
# apk spells architecture independent "noarch", the same string
# include/package-pack.mk emits for PKGARCH=all
finalize luci-app-opsiphon noarch "$LUCI_DEPENDS" "$LUCI_DESC"

echo
echo ">>> packages in $DIST"
ls -l "$DIST"/*.apk
