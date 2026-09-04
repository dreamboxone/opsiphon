# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 dreamboxone <https://t.me/routekernel1>
# Part of opsiphon - Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
#
# packages.inc.sh - what goes into the two packages, and what they are called.
#
# Sourced by build-apk.sh (OpenWrt 25.12 and later) and build-ipk.sh (23.05,
# 24.10). Everything that both formats have to agree on lives here, so that
# adding a helper or bumping a version is a single edit and the two packages
# can never drift apart.
#
# Not executable on its own.

VERSION=1.0.3
RELEASE=2
PKGVER="$VERSION-r$RELEASE"
LICENSE="GPL-3.0-only"
URL="https://github.com/dreamboxone/opsiphon"
MAINTAINER="routekernel <https://t.me/routekernel1>"

OPSIPHON_DEPENDS="jshn libubox"
LUCI_DEPENDS="opsiphon luci-base"

OPSIPHON_DESC="Psiphon circumvention client for OpenWrt (psiphon-tunnel-core) with procd service, UCI config, SOCKS5/HTTP proxies, egress country selection and live status collector."
LUCI_DESC="LuCI web interface for Opsiphon: connect/disconnect, live tunnel status, egress country, traffic statistics, boot autostart and the Psiphon notice log."

# stage_opsiphon <staging-root> <source-root> <core-binary>
#
# Lays out the file tree the opsiphon package installs, and writes the
# maintainer-script fragments next to it as <name>.conffiles / .postinst /
# .prerm. Each packager turns those fragments into whatever its own format
# expects.
stage_opsiphon() {
	work="$1"; root="$2"; core="$3"
	f="$root/package/opsiphon/files"
	i="$work/opsiphon"

	install -d "$i/usr/bin" "$i/etc/config" "$i/etc/init.d" \
	           "$i/usr/libexec/rpcd" "$i/etc/opsiphon/data"
	install -m 0755 "$core"                  "$i/usr/bin/psiphon-tunnel-core"
	install -m 0644 "$f/opsiphon.config"     "$i/etc/config/opsiphon"
	install -m 0755 "$f/opsiphon.init"       "$i/etc/init.d/opsiphon"
	install -m 0755 "$f/opsiphon-mkconfig"   "$i/usr/libexec/opsiphon-mkconfig"
	install -m 0755 "$f/opsiphon-notices"    "$i/usr/libexec/opsiphon-notices"
	install -m 0755 "$f/opsiphon-stat"       "$i/usr/libexec/opsiphon-stat"
	install -m 0755 "$f/opsiphon-usage"      "$i/usr/libexec/opsiphon-usage"
	install -m 0755 "$f/opsiphon-rules"      "$i/usr/libexec/opsiphon-rules"
	install -m 0755 "$f/opsiphon-passwall"   "$i/usr/libexec/opsiphon-passwall"
	install -m 0755 "$f/luci.opsiphon"       "$i/usr/libexec/rpcd/luci.opsiphon"

	# Ship the core revision as a file. The GUI shows it, and reading a file
	# is the only way to get it without running the core inside an rpcd
	# request - see core_version() in luci.opsiphon.
	rev="$(dirname "$core")/core-revision.txt"
	if [ -s "$rev" ]; then
		install -m 0644 "$rev" "$i/etc/opsiphon/core-revision"
	fi

	echo "/etc/config/opsiphon" > "$work/opsiphon.conffiles"

	cat > "$work/opsiphon.postinst" <<'EOF'
mkdir -p /etc/opsiphon/data
/etc/init.d/rpcd reload >/dev/null 2>&1
exit 0
EOF

	cat > "$work/opsiphon.prerm" <<'EOF'
/etc/init.d/opsiphon stop >/dev/null 2>&1
/etc/init.d/opsiphon disable >/dev/null 2>&1
exit 0
EOF
}

# stage_luci <staging-root> <source-root>
stage_luci() {
	work="$1"; root="$2"
	l="$root/package/luci-app-opsiphon/root"
	i="$work/luci-app-opsiphon"

	install -d "$i/www/luci-static/resources/view/opsiphon" \
	           "$i/usr/share/luci/menu.d" "$i/usr/share/rpcd/acl.d"
	install -m 0644 "$l/www/luci-static/resources/view/opsiphon/overview.js" \
		"$i/www/luci-static/resources/view/opsiphon/overview.js"
	install -m 0644 "$l/www/luci-static/resources/view/opsiphon/logo.png" \
		"$i/www/luci-static/resources/view/opsiphon/logo.png"
	install -m 0644 "$l/usr/share/luci/menu.d/luci-app-opsiphon.json" \
		"$i/usr/share/luci/menu.d/luci-app-opsiphon.json"
	install -m 0644 "$l/usr/share/rpcd/acl.d/luci-app-opsiphon.json" \
		"$i/usr/share/rpcd/acl.d/luci-app-opsiphon.json"

	cat > "$work/luci-app-opsiphon.postinst" <<'EOF'
rm -f /tmp/luci-indexcache* 2>/dev/null
rm -rf /tmp/luci-modulecache 2>/dev/null
/etc/init.d/rpcd reload >/dev/null 2>&1
/etc/init.d/uhttpd restart >/dev/null 2>&1
exit 0
EOF
}

# fix_modes <staging-dir>
#
# root:root, dirs 0755, data 0644, programs 0755. Anything meant to be run is
# recognised by where it lives rather than by name, so a new helper cannot be
# shipped non-executable by accident.
fix_modes() {
	d="$1"
	find "$d" -type d -exec chmod 0755 {} +
	find "$d" -type f -exec chmod 0644 {} +
	for sub in usr/bin usr/sbin etc/init.d usr/libexec usr/libexec/rpcd; do
		[ -d "$d/$sub" ] && find "$d/$sub" -maxdepth 1 -type f -exec chmod 0755 {} +
	done
	chown -R 0:0 "$d"
}
