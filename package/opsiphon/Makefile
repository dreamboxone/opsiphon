#
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 dreamboxone <https://t.me/routekernel1>
# Part of opsiphon - Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
#
# opsiphon - Psiphon circumvention client for OpenWrt
# https://github.com/dreamboxone/opsiphon   -   support: https://t.me/routekernel1
#
# The Psiphon core is a Go binary that is cross compiled outside of the SDK
# (see build/build-core.sh) and dropped into files/psiphon-tunnel-core before
# this package is built.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=opsiphon
PKG_VERSION:=1.0.2
PKG_RELEASE:=4

PKG_MAINTAINER:=routekernel <https://t.me/routekernel1>
PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/opsiphon
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=VPN
  TITLE:=Psiphon circumvention client (psiphon-tunnel-core)
  URL:=https://github.com/dreamboxone/opsiphon
  DEPENDS:=+jshn +libubox
  # metadata arch: nothing is compiled here (the Go core is prebuilt), so the
  # package arch can be set explicitly and does not depend on the SDK target
  PKGARCH:=$(if $(OPSIPHON_PKGARCH),$(OPSIPHON_PKGARCH),$(ARCH_PACKAGES))
endef

define Package/opsiphon/description
 Psiphon censorship circumvention client for OpenWrt, built on the open
 source psiphon-tunnel-core console client.

 Provides a procd service, UCI configuration, a local SOCKS5 and HTTP proxy,
 egress country selection and a live status / traffic statistics collector
 that feeds luci-app-opsiphon.
endef

define Package/opsiphon/conffiles
/etc/config/opsiphon
endef

# Nothing to compile inside the SDK: the Go core is prebuilt per architecture.
define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Configure
endef

define Build/Compile
	@if [ ! -f ./files/psiphon-tunnel-core ]; then \
		echo "ERROR: ./files/psiphon-tunnel-core is missing."; \
		echo "Run build/build-core.sh (or build/build-package.sh) first."; \
		exit 1; \
	fi
endef

define Package/opsiphon/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/psiphon-tunnel-core $(1)/usr/bin/psiphon-tunnel-core

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/opsiphon.config $(1)/etc/config/opsiphon

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/opsiphon.init $(1)/etc/init.d/opsiphon

	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/opsiphon-mkconfig $(1)/usr/libexec/opsiphon-mkconfig
	$(INSTALL_BIN) ./files/opsiphon-notices $(1)/usr/libexec/opsiphon-notices
	$(INSTALL_BIN) ./files/opsiphon-stat $(1)/usr/libexec/opsiphon-stat
	$(INSTALL_BIN) ./files/opsiphon-usage $(1)/usr/libexec/opsiphon-usage
	$(INSTALL_BIN) ./files/opsiphon-rules $(1)/usr/libexec/opsiphon-rules
	$(INSTALL_BIN) ./files/opsiphon-passwall $(1)/usr/libexec/opsiphon-passwall

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./files/luci.opsiphon $(1)/usr/libexec/rpcd/luci.opsiphon
endef

define Package/opsiphon/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
mkdir -p /etc/opsiphon/data
/etc/init.d/rpcd reload >/dev/null 2>&1
echo "opsiphon installed. Open LuCI -> Services -> Psiphon and press Connect."
exit 0
endef

define Package/opsiphon/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/opsiphon stop >/dev/null 2>&1
/etc/init.d/opsiphon disable >/dev/null 2>&1
exit 0
endef

$(eval $(call BuildPackage,opsiphon))
