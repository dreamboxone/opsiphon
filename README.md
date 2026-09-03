# Opsiphon — Psiphon for OpenWrt (with LuCI GUI)

**Version 1.0.0** · support / contact: [t.me/routekernel1](https://t.me/routekernel1)
🇮🇷 **[راهنمای فارسی: README.fa.md](README.fa.md)**

Opsiphon runs the open source
[psiphon-tunnel-core](https://github.com/Psiphon-Labs/psiphon-tunnel-core)
console client as a proper OpenWrt service and adds a LuCI web page, so the
tunnel is started, watched and configured from the router's web interface
instead of the command line.

Built for **OpenWrt 25.12**, target `ipq40xx/chromium`, architecture
`arm_cortex-a7_neon-vfpv4`. The build scripts cover other architectures too.

---

## 1. Install

Ready-made packages are in `dist/`:

```sh
scp dist/*.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 'apk add --allow-untrusted /tmp/opsiphon-*.apk /tmp/luci-app-opsiphon-*.apk'
```

Then open LuCI → **Services → Psiphon**.

Nothing runs right after installation: the tunnel stays off until you press
**Connect** once. That is deliberate — you decide when the router starts
tunnelling.

Dependencies (`jshn`, `libubox`, `luci-base`) are part of a normal OpenWrt +
LuCI installation, so no internet access is needed to install.

Without packages:

```sh
./install-manual.sh root@192.168.1.1 arm_cortex-a7_neon-vfpv4
```

---

## 2. The LuCI page

### Status panel

| Field | Meaning |
| --- | --- |
| **Connection** | `Stopped` — service not running · `Connecting…` — running but no tunnel yet · `Connected` — tunnel is up |
| **Egress country** | Country the traffic leaves the Psiphon network from — where sites think you are |
| **Detected client country** | Country Psiphon thinks *you* are in, as seen from its servers |
| **Connected for** | How long the current tunnel has been up |
| **Traffic (down / up)** | Bytes received / sent through the tunnel since it was started |
| **Local proxies** | The SOCKS5 and HTTP proxy addresses the tunnel is offering |
| **Start on boot** | Whether the tunnel comes back after a reboot |
| **Last event** | Latest Psiphon notice (useful when it will not connect) |

The panel refreshes every 3 seconds.

### Buttons

| Button | What it does |
| --- | --- |
| **Connect** | Sets `enabled=1` and starts the service. This is the only switch that starts the tunnel. |
| **Disconnect** | Sets `enabled=0` and stops the service. |
| **Reconnect** | Restarts the service — use it after changing settings, or to get a different server. |
| **View notices** | Shows the recent Psiphon notice log (newest first) — the place to look when something fails. |

### General tab

| Option | What it does |
| --- | --- |
| **Start on boot** | Re-opens the tunnel automatically after a reboot. Only matters once you have connected at least once. |
| **Egress country** | Forces the exit country. `Auto` (default) lets Psiphon choose the fastest server — leave it on Auto unless you need a specific country. The list is filled from the countries Psiphon actually reports as available. |
| **SOCKS5 port** | Port of the local SOCKS5 proxy (default `1080`). `0` disables it. |
| **HTTP proxy port** | Port of the local HTTP proxy (default `8080`). `0` disables it. |
| **Listen interface** | Empty = proxies are reachable only from the router itself (`127.0.0.1`). Set to `br-lan` to make them reachable from your LAN devices as `<router-ip>:1080`. |
| **Collect traffic statistics** | Turns on Psiphon's bytes-transferred notices, which feed the traffic counters. Turn it off to make Psiphon a bit quieter. |

### Advanced tab

| Option | What it does |
| --- | --- |
| **Data directory** | Where Psiphon stores its downloaded server list and datastore. Default `/etc/opsiphon/data` (survives reboots). Point it at a USB stick (e.g. `/mnt/sda1/opsiphon`) to reduce writes to the router flash. |
| **Establish timeout (s)** | Give up on a connection attempt after N seconds and start over. `0` = Psiphon's own default. |
| **Limit tunnel protocols** | Restricts which obfuscation protocols Psiphon may use (`OSSH`, `QUIC-OSSH`, `FRONTED-MEEK-OSSH`, …). Leave all unchecked — Psiphon is designed to pick whatever gets through your network. Only useful for testing which protocol survives a particular filter. |
| **Psiphon network** — *Sponsor ID*, *Propagation channel ID*, *Remote server list URL*, *Signature key* | These identify the client to the Psiphon network. The Sponsor / Propagation IDs tell Psiphon which server set and home page this client should get; the server list URL is where the client bootstraps its list of servers from, and the signature key is what proves that list is authentic. The defaults are the **public community values** published with the open source psiphon-tunnel-core. Change them only if Psiphon Inc. gave you a private sponsor configuration. |

---

## 3. Using the tunnel

Psiphon gives you a tunnel with two local proxies. Sending traffic into it is a
separate decision:

**One device or one browser** — set *Listen interface* to `br-lan`, press
*Reconnect*, then configure the client:

* SOCKS5 → `<router-ip>:1080`
* HTTP → `<router-ip>:8080`

**The whole LAN** — use a proxy manager that can redirect all traffic, such as
PassWall2 or OpenClash, and give it the Psiphon proxy as an upstream: add a node
of type `Socks5` with server `127.0.0.1`, port `1080`, and select it as the
active node. The proxy manager then handles transparent redirection, DNS and
bypass rules (for example, keeping local Iranian sites out of the tunnel).

---

## 4. Command line

```sh
/etc/init.d/opsiphon start|stop|restart|status
opsiphon-stat                 # status summary
opsiphon-stat -l              # plus the last notices

uci set opsiphon.config.region='NL'
uci commit opsiphon
/etc/init.d/opsiphon restart
```

Full configuration lives in `/etc/config/opsiphon`; every LuCI option maps 1:1
to a UCI option of the same name.

---

## 5. Building

### The Psiphon core

Needs Go 1.26+ and git. CGO is disabled, so the result is a static binary that
runs on musl OpenWrt as is.

```sh
./build/build-core.sh armv7      # ipq40xx / Cortex-A7 (default)
./build/build-core.sh aarch64    # Filogic, Rockchip, …
./build/build-core.sh mipsel     # ramips / mt7621
./build/build-core.sh x86_64
```

Output: `prebuilt/<openwrt-arch>/psiphon-tunnel-core`.

### The packages

```sh
./build/build-apk.sh arm_cortex-a7_neon-vfpv4 \
    ~/openwrt-sdk-25.12.5-*/staging_dir/host/bin/apk
```

`build-apk.sh` performs exactly the packaging steps `include/package-pack.mk`
performs for APK targets (file list, conffiles + sha256, install / upgrade /
deinstall scripts) and then calls `apk mkpkg`. Nothing is compiled, so it only
needs the `apk` tool from any 25.12 SDK — handy because the full OpenWrt build
system refuses to run on a case-insensitive filesystem. Run it as root (or under
a working fakeroot) so packaged files end up `root:root`.

On a proper Linux build host the full SDK route also works:

```sh
./build/build-package.sh ~/openwrt-sdk-25.12.5-<target> arm_cortex-a7_neon-vfpv4
```

---

## 6. How it works

```
psiphon-tunnel-core  --stderr-->  opsiphon-notices (awk)  -->  /var/run/opsiphon/state
        ^                                                              |
        |                                                              v
/var/etc/opsiphon.json  <-- opsiphon-mkconfig <-- UCI      rpcd: luci.opsiphon  -->  LuCI
```

* `opsiphon-mkconfig` renders the Psiphon JSON config from UCI at every start.
* `opsiphon-notices` consumes Psiphon's notice stream and keeps live state plus a
  bounded log in RAM (max 400 lines) — nothing is written to flash.
* `luci.opsiphon` is the rpcd/ubus backend the LuCI page polls and calls.

---

## 7. Notes

* The default sponsor/propagation IDs are the public community values; the
  server pool is not identical to the official Psiphon apps.
* The core binary is ~20 MB — check `df -h /overlay` before installing on
  small-flash devices.
* Replacing the logo: drop your own image at
  `package/luci-app-opsiphon/root/www/luci-static/resources/view/opsiphon/logo.png`
  and rebuild.

## Licence

GPL-3.0-only, matching psiphon-tunnel-core. Psiphon is a trademark of Psiphon
Inc.; this project is an independent OpenWrt packaging of their open source
client and is not affiliated with or endorsed by them.
