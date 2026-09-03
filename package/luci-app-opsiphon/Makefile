#
# luci-app-opsiphon - LuCI web interface for Opsiphon (Psiphon on OpenWrt)
# https://github.com/dreamboxone/opsiphon   -   support: https://t.me/routekernel1
#
# Written as a plain OpenWrt package (no luci.mk) so it builds in a bare SDK
# without the LuCI feed installed.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-opsiphon
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=routekernel <https://t.me/routekernel1>
PKG_LICENSE:=GPL-3.0-only

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-opsiphon
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI interface for Opsiphon (Psiphon)
  URL:=https://github.com/dreamboxone/opsiphon
  DEPENDS:=+opsiphon +luci-base
  PKGARCH:=all
endef

define Package/luci-app-opsiphon/description
 Web interface for Opsiphon: connect / disconnect, live tunnel status,
 egress country selection, traffic statistics, boot autostart and the
 Psiphon notice log - all from LuCI.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-app-opsiphon/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/opsiphon
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/opsiphon/overview.js \
		$(1)/www/luci-static/resources/view/opsiphon/overview.js

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-opsiphon.json \
		$(1)/usr/share/luci/menu.d/luci-app-opsiphon.json

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-opsiphon.json \
		$(1)/usr/share/rpcd/acl.d/luci-app-opsiphon.json
endef

define Package/luci-app-opsiphon/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* 2>/dev/null
/etc/init.d/rpcd reload >/dev/null 2>&1
/etc/init.d/uhttpd restart >/dev/null 2>&1
exit 0
endef

$(eval $(call BuildPackage,luci-app-opsiphon))
