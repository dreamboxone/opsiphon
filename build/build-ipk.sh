#!/bin/sh
#
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 dreamboxone <https://t.me/routekernel1>
# Part of opsiphon - Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
#
# build-ipk.sh - build installable .ipk packages for opsiphon and
# luci-app-opsiphon, for the OpenWrt releases that still use opkg (23.05,
# 24.10 and older). OpenWrt 25.12 dropped opkg for apk; use build-apk.sh
# there.
#
# Both scripts take their file lists from packages.inc.sh, so the .ipk and
# the .apk always contain the same tree.
#
#
# An .ipk is a gzipped tar holding three members, in this order:
#
#     ./debian-binary     the four bytes "2.0\n"
#     ./data.tar.gz       the file tree, rooted at ./
#     ./control.tar.gz    control, conffiles and the maintainer scripts
#
# which is what scripts/ipkg-build in the OpenWrt tree produces. No SDK and
# no apk tool are needed - only tar and gzip.
#
# Usage:
#   ./build/build-ipk.sh [openwrt-arch]

set -e

# File ownership inside the archive must be root:root. Run under fakeroot
# when we are not root, exactly as build-apk.sh does.
if [ "$(id -u)" != "0" ] && [ -z "$FAKEROOTKEY" ]; then
	FAKEROOT="$(command -v fakeroot || true)"
	if [ -n "$FAKEROOT" ]; then
		exec "$FAKEROOT" -- "$0" "$@"
	fi
	echo "warning: fakeroot not found - package file ownership may be wrong" >&2
fi

ARCH="${1:-arm_cortex-a7_neon-vfpv4}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/build/packages.inc.sh"

WORK="${OPSIPHON_WORK:-${TMPDIR:-/tmp}/opsiphon-ipk-build}"
DIST="$ROOT/dist"

CORE="$ROOT/prebuilt/$ARCH/psiphon-tunnel-core"
[ -f "$CORE" ] || { echo "missing core binary: $CORE (run build/build-core.sh)"; exit 1; }

# a fixed timestamp keeps repeated builds of the same tree byte identical
EPOCH="${SOURCE_DATE_EPOCH:-$(date -u +%s)}"

echo ">>> arch     : $ARCH"
echo ">>> version  : $PKGVER"

rm -rf "$WORK"
mkdir -p "$WORK" "$DIST"

# tgz <output> <directory> - deterministic gzipped tar of a directory's
# contents, owned by root, rooted at ./
tgz() {
	out="$1"; dir="$2"
	( cd "$dir" && tar --numeric-owner --owner=0 --group=0 \
	                   --sort=name --mtime="@$EPOCH" \
	                   -cf - ./ ) | gzip -9n > "$out"
}

# finalize <name> <arch> <section> <depends> <description>
#   expects $WORK/<name>/ populated with the installed file tree,
#   optional $WORK/<name>.conffiles, $WORK/<name>.postinst, $WORK/<name>.prerm
finalize() {
	name="$1"; arch="$2"; section="$3"; deps="$4"; desc="$5"
	idir="$WORK/$name"
	cdir="$WORK/control-$name"
	bdir="$WORK/build-$name"
	mkdir -p "$cdir" "$bdir"

	fix_modes "$idir"

	# opkg writes /usr/lib/opkg/info/<name>.list itself at install time, so
	# unlike the apk package the tree must not carry a file list of its own

	isize=$(du -sb "$idir" 2>/dev/null | cut -f1) || isize=""
	[ -n "$isize" ] || isize=$(du -sk "$idir" | cut -f1 | awk '{print $1*1024}')

	{
		echo "Package: $name"
		echo "Version: $PKGVER"
		echo "Depends: $(echo "$deps" | sed 's/  */, /g')"
		echo "Source: $URL"
		echo "SourceName: $name"
		echo "License: $LICENSE"
		echo "Section: $section"
		echo "SourceDateEpoch: $EPOCH"
		echo "URL: $URL"
		echo "Maintainer: $MAINTAINER"
		echo "Architecture: $arch"
		echo "Installed-Size: $isize"
		echo "Description: $desc"
	} > "$cdir/control"

	[ -f "$WORK/$name.conffiles" ] && cp "$WORK/$name.conffiles" "$cdir/conffiles"

	# opkg calls postinst/prerm; default_postinst and default_prerm then
	# source the -pkg halves, which is where package specific work belongs
	{
		echo "#!/bin/sh"
		echo '[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0'
		echo '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0'
		echo '. ${IPKG_INSTROOT}/lib/functions.sh'
		echo 'default_postinst $0 $@'
	} > "$cdir/postinst"

	{
		echo "#!/bin/sh"
		echo '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0'
		echo '. ${IPKG_INSTROOT}/lib/functions.sh'
		echo 'default_prerm $0 $@'
	} > "$cdir/prerm"

	if [ -f "$WORK/$name.postinst" ]; then
		sed '/^[[:space:]]*#!/d' "$WORK/$name.postinst" > "$cdir/postinst-pkg"
	fi
	if [ -f "$WORK/$name.prerm" ]; then
		sed '/^[[:space:]]*#!/d' "$WORK/$name.prerm" > "$cdir/prerm-pkg"
	fi

	chmod 0644 "$cdir/control"
	[ -f "$cdir/conffiles" ] && chmod 0644 "$cdir/conffiles"
	chmod 0755 "$cdir/postinst" "$cdir/prerm"
	[ -f "$cdir/postinst-pkg" ] && chmod 0755 "$cdir/postinst-pkg"
	[ -f "$cdir/prerm-pkg" ] && chmod 0755 "$cdir/prerm-pkg"
	chown -R 0:0 "$cdir"

	printf '2.0\n' > "$bdir/debian-binary"
	tgz "$bdir/data.tar.gz"    "$idir"
	tgz "$bdir/control.tar.gz" "$cdir"

	out="$DIST/${name}_${PKGVER}_${arch}.ipk"
	rm -f "$out"
	( cd "$bdir" && tar --numeric-owner --owner=0 --group=0 \
	                    --mtime="@$EPOCH" \
	                    -cf - ./debian-binary ./data.tar.gz ./control.tar.gz ) \
		| gzip -9n > "$out"

	echo ">>> built $(basename "$out") ($(du -h "$out" | cut -f1))"
}

stage_opsiphon "$WORK" "$ROOT" "$CORE"
finalize opsiphon "$ARCH" net "$OPSIPHON_DEPENDS" "$OPSIPHON_DESC"

stage_luci "$WORK" "$ROOT"
# opkg spells architecture independent "all"
finalize luci-app-opsiphon all luci "$LUCI_DEPENDS" "$LUCI_DESC"

echo
echo ">>> packages in $DIST"
ls -l "$DIST"/*.ipk
