# Opsiphon — Psiphon for OpenWrt (with LuCI GUI)

**Version 1.0.0** · support / contact: [t.me/routekernel1](https://t.me/routekernel1)

Opsiphon runs the open source [psiphon-tunnel-core](https://github.com/Psiphon-Labs/psiphon-tunnel-core)
console client as a proper OpenWrt service and adds a LuCI web interface, so the
tunnel can be turned on, watched and configured from the router's web UI instead
of the command line.

Built and tested against **OpenWrt 25.12.5**, target `ipq40xx/chromium`,
architecture `arm_cortex-a7_neon-vfpv4`.

## What you get

| Windows Psiphon feature | Opsiphon equivalent |
| --- | --- |
| Connect / Disconnect button | Connect / Disconnect / Reconnect buttons in LuCI, live state badge |
| Connection status, egress country | Live status panel (tunnel state, egress country, detected client country, uptime) |
| Region selection | **Egress country** dropdown, auto-populated from Psiphon's `AvailableEgressRegions` |
| Start with the system | **Start on boot** switch (manages the procd rc.d symlink) |
| Traffic counters | Download / upload counters from Psiphon's `BytesTransferred` notices |
| Log window | **View notices** modal with the last Psiphon notices |
| Local proxy ports | Configurable SOCKS5 / HTTP ports, optional binding to a LAN interface |

Extra, router-specific:

* UCI configuration (`/etc/config/opsiphon`) — everything scriptable.
* procd service with auto-respawn, no flash writes for logs.
* `opsiphon-stat` CLI for status over SSH.
* Sponsor / propagation ID and remote server list are configurable, so a private
  Psiphon sponsor configuration can be used instead of the public community one.

## Repository layout

```
build/build-core.sh        cross-compile the Psiphon core for any OpenWrt arch
build/build-package.sh     build .ipk/.apk with an official OpenWrt SDK
package/opsiphon/          service package (binary, procd init, UCI, rpcd backend)
package/luci-app-opsiphon/ LuCI application (JS view, menu, ACL)
prebuilt/<arch>/           cross-compiled psiphon-tunnel-core binaries
install-manual.sh          install over SSH without building a package
```

## 1. Build the Psiphon core

Needs Go (1.26+, matching psiphon-tunnel-core's `go.mod`) and git. CGO is off,
so the result is a static binary that runs on musl OpenWrt unchanged.

```sh
./build/build-core.sh armv7        # ipq40xx / Cortex-A7  (default)
./build/build-core.sh aarch64      # Filogic, Rockchip, …
./build/build-core.sh mipsel       # ramips / mt7621
./build/build-core.sh x86_64       # x86 OpenWrt
```

The binary lands in `prebuilt/<openwrt-arch>/psiphon-tunnel-core`.
A ready-made `arm_cortex-a7_neon-vfpv4` build is already included.

## 2. Build the packages with the OpenWrt SDK

```sh
./build/build-package.sh ~/openwrt-sdk-25.12.5-x86-64_gcc-14.3.0_musl.Linux-x86_64 \
    arm_cortex-a7_neon-vfpv4
```

Results are copied to `dist/`. OpenWrt 25.12 uses `apk`, so install with:

```sh
scp dist/*.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 'apk add --allow-untrusted /tmp/opsiphon-*.apk /tmp/luci-app-opsiphon-*.apk'
```

On OpenWrt 24.10 and older the SDK produces `.ipk` instead:

```sh
ssh root@192.168.1.1 'opkg install /tmp/opsiphon_*.ipk /tmp/luci-app-opsiphon_*.ipk'
```

## 3. Or install without packages

```sh
./install-manual.sh root@192.168.1.1 arm_cortex-a7_neon-vfpv4
```

This copies the same files to the same paths, refreshes rpcd/uhttpd and starts
the service.

## Using it

Open LuCI → **Services → Opsiphon (Psiphon)**.

* **Connect** starts the tunnel (and sets `enabled=1`), **Disconnect** stops it.
* The status panel refreshes every 3 seconds.
* The tunnel exposes `127.0.0.1:1080` (SOCKS5) and `127.0.0.1:8080` (HTTP).

### Sending the whole LAN through the tunnel

Opsiphon provides the tunnel; routing the LAN through it is a separate job. Two
options:

1. **PassWall2** (GUI): add a node of type *Socks5*, server `127.0.0.1`,
   port `1080`, select it as the main node. PassWall2 then handles redirection,
   DNS and bypass rules.
2. **Direct proxy use**: set *Listen interface* to `br-lan` in the Advanced tab
   and point clients at `<router-ip>:1080` (SOCKS5) or `<router-ip>:8080` (HTTP).

### CLI

```sh
/etc/init.d/opsiphon start|stop|restart|status
opsiphon-stat            # or: /usr/libexec/opsiphon-stat -l   (with notices)
uci set opsiphon.config.region='NL'; uci commit; /etc/init.d/opsiphon restart
```

## Configuration reference (`/etc/config/opsiphon`)

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `1` | Master switch (Connect / Disconnect) |
| `autostart` | `1` | Start on boot |
| `region` | *(empty)* | Egress country, ISO 3166-1 alpha-2, empty = auto |
| `socks_port` | `1080` | Local SOCKS5 port, `0` disables it |
| `http_port` | `8080` | Local HTTP proxy port, `0` disables it |
| `listen_interface` | *(empty)* | Bind proxies to an interface, e.g. `br-lan` |
| `stats` | `1` | Collect traffic statistics |
| `data_dir` | `/etc/opsiphon/data` | Psiphon datastore (move to USB to spare flash) |
| `establish_timeout` | `0` | Give up after N seconds, 0 = Psiphon default |
| `protocols` | *(empty)* | Limit tunnel protocols, empty = all |
| `network.sponsor_id` | `FFFFFFFFFFFFFFFF` | Sponsor ID |
| `network.propagation_id` | `FFFFFFFFFFFFFFFF` | Propagation channel ID |
| `network.server_list_url` | *(community URL)* | Remote server list |
| `network.server_list_key` | *(built-in)* | Remote server list signature key |

## How it works

```
psiphon-tunnel-core  --stderr-->  opsiphon-notices (awk)  -->  /var/run/opsiphon/state
        ^                                                              |
        |                                                              v
/var/etc/opsiphon.json  <-- opsiphon-mkconfig <-- UCI      rpcd: luci.opsiphon  -->  LuCI
```

* `opsiphon-mkconfig` renders the Psiphon JSON config from UCI at every start.
* `opsiphon-notices` consumes Psiphon's notice stream, keeps live state and a
  bounded log in RAM (`/var/log/opsiphon/notices.log`, max 400 lines) — nothing
  is written to flash.
* `luci.opsiphon` is the rpcd/ubus backend the LuCI view polls and calls.

## Notes and limits

* The default sponsor/propagation IDs are the **public community values** from
  the open source psiphon-tunnel-core sample configuration. They work, but the
  server pool is not identical to the official Psiphon apps. If Psiphon Inc.
  gave you a sponsor configuration, put your own values in the *Psiphon network*
  tab.
* The core binary is ~20 MB. Check free space with `df -h /overlay` before
  installing on small-flash devices.
* `data_dir` defaults to `/etc/opsiphon/data` so the server list survives
  reboots. On flash-sensitive devices point it at external storage.

## Licence

GPL-3.0-only, matching psiphon-tunnel-core.
