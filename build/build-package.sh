#!/bin/sh
# build-package.sh - build the opsiphon + luci-app-opsiphon packages with an
# official OpenWrt SDK.
#
# Part of opsiphon 1.0.0 - https://github.com/dreamboxone/opsiphon
# Support: https://t.me/routekernel1
#
# Usage:
#   ./build/build-package.sh /path/to/openwrt-sdk-25.12.5-...  [openwrt-arch]
#
# Example (the ipq40xx / Cortex-A7 routers this was written for):
#   ./build/build-package.sh ~/openwrt-sdk-25.12.5-x86-64_gcc-14.3.0_musl.Linux-x86_64 \
#       arm_cortex-a7_neon-vfpv4
#
# Note on SDK targets: neither package compiles anything (the Psiphon core is a
# prebuilt static Go binary and the LuCI app is plain JS/JSON), so any 25.12 SDK
# can produce the packages. The package architecture is taken from the second
# argument and written into the package metadata via OPSIPHON_PKGARCH, so an
# x86-64 SDK can package the ARMv7 core correctly. Using the SDK that matches
# your target is still the cleanest option when you have it.
#
# Results are copied to ./dist/.

set -e

SDK="$1"
ARCH="${2:-arm_cortex-a7_neon-vfpv4}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$SDK" ] || [ ! -f "$SDK/rules.mk" ]; then
	echo "usage: $0 /path/to/openwrt-sdk-<version>-<target> [openwrt-arch]"
	echo
	echo "The first argument must be an extracted OpenWrt SDK directory"
	echo "(the one containing rules.mk, scripts/ and staging_dir/)."
	exit 1
fi

CORE="$ROOT/prebuilt/$ARCH/psiphon-tunnel-core"
if [ ! -f "$CORE" ]; then
	echo "missing core binary: $CORE"
	echo "build it first:  ./build/build-core.sh <target>"
	exit 1
fi

SDK_ARCH="$(ls -d "$SDK"/staging_dir/target-* 2>/dev/null | head -1 | sed 's|.*/target-||')"

echo ">>> SDK       : $SDK"
echo ">>> SDK target: ${SDK_ARCH:-unknown}"
echo ">>> package   : $ARCH"
echo ">>> core      : $CORE"

cp "$CORE" "$ROOT/package/opsiphon/files/psiphon-tunnel-core"
chmod 755 "$ROOT/package/opsiphon/files/psiphon-tunnel-core"

# make the two packages visible to the SDK
mkdir -p "$SDK/package/opsiphon-src"
rm -rf "$SDK/package/opsiphon-src/opsiphon" "$SDK/package/opsiphon-src/luci-app-opsiphon"
cp -a "$ROOT/package/opsiphon" "$SDK/package/opsiphon-src/opsiphon"
cp -a "$ROOT/package/luci-app-opsiphon" "$SDK/package/opsiphon-src/luci-app-opsiphon"

cd "$SDK"

# a bare SDK has no build configuration yet
if [ ! -f "$SDK/.config" ]; then
	echo ">>> preparing SDK defaults (no .config found)"
	make defconfig
fi

JOBS="$(nproc 2>/dev/null || echo 1)"

echo ">>> building opsiphon"
make package/opsiphon/compile OPSIPHON_PKGARCH="$ARCH" V=s -j"$JOBS"

echo ">>> building luci-app-opsiphon"
make package/luci-app-opsiphon/compile V=s -j"$JOBS"

mkdir -p "$ROOT/dist"
found=0
for f in $(find "$SDK/bin" \( -name 'opsiphon*' -o -name 'luci-app-opsiphon*' \) 2>/dev/null); do
	case "$f" in
		*.ipk|*.apk)
			cp -f "$f" "$ROOT/dist/"
			echo ">>> $(basename "$f")"
			found=1
			;;
	esac
done

if [ "$found" = "0" ]; then
	echo "!!! no .ipk/.apk found under $SDK/bin - check the build log above"
	exit 1
fi

echo
echo ">>> packages copied to $ROOT/dist/"
ls -l "$ROOT/dist/"
