/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 dreamboxone <https://t.me/routekernel1>
 * Part of opsiphon - Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
 */

'use strict';
'require view';
'require form';
'require rpc';
'require poll';
'require ui';
'require uci';

var OPSIPHON_VERSION = '1.0.0';
var OPSIPHON_TELEGRAM = 'https://t.me/routekernel1';
var OPSIPHON_REPO = 'https://github.com/dreamboxone/opsiphon';

var callState = rpc.declare({
	object: 'luci.opsiphon',
	method: 'state',
	expect: { '': {} }
});

var callAction = rpc.declare({
	object: 'luci.opsiphon',
	method: 'action',
	params: [ 'name' ],
	expect: { '': {} }
});

var callLog = rpc.declare({
	object: 'luci.opsiphon',
	method: 'log',
	params: [ 'lines' ],
	expect: { '': {} }
});

/* Psiphon egress regions. Refreshed at runtime from the AvailableEgressRegions
   notice; this is only the offline fallback. */
var REGION_NAMES = {
	'AT': 'Austria',        'AU': 'Australia',      'BE': 'Belgium',
	'BG': 'Bulgaria',       'BR': 'Brazil',         'CA': 'Canada',
	'CH': 'Switzerland',    'CL': 'Chile',          'CZ': 'Czechia',
	'DE': 'Germany',        'DK': 'Denmark',        'EE': 'Estonia',
	'ES': 'Spain',          'FI': 'Finland',        'FR': 'France',
	'GB': 'United Kingdom', 'GR': 'Greece',         'HR': 'Croatia',
	'HU': 'Hungary',        'IE': 'Ireland',        'IN': 'India',
	'IS': 'Iceland',        'IT': 'Italy',          'JP': 'Japan',
	'KR': 'South Korea',    'LT': 'Lithuania',      'LV': 'Latvia',
	'MX': 'Mexico',         'NL': 'Netherlands',    'NO': 'Norway',
	'NZ': 'New Zealand',    'PL': 'Poland',         'PT': 'Portugal',
	'RO': 'Romania',        'RS': 'Serbia',         'SE': 'Sweden',
	'SG': 'Singapore',      'SK': 'Slovakia',       'TR': 'Turkiye',
	'UA': 'Ukraine',        'US': 'United States',  'ZA': 'South Africa'
};

var TUNNEL_PROTOCOLS = [
	'SSH', 'OSSH', 'TLS-OSSH', 'SHADOWSOCKS-OSSH',
	'UNFRONTED-MEEK-OSSH', 'UNFRONTED-MEEK-HTTPS-OSSH',
	'UNFRONTED-MEEK-SESSION-TICKET-OSSH',
	'FRONTED-MEEK-OSSH', 'FRONTED-MEEK-HTTP-OSSH',
	'QUIC-OSSH', 'FRONTED-MEEK-QUIC-OSSH',
	'TAPDANCE-OSSH', 'CONJURE-OSSH'
];

function fmtBytes(n) {
	n = parseInt(n) || 0;
	var u = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], i = 0;
	while (n >= 1024 && i < u.length - 1) { n = n / 1024; i++; }
	return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
}

function fmtDuration(sec) {
	sec = parseInt(sec) || 0;
	if (sec <= 0) return '-';
	var d = Math.floor(sec / 86400),
	    h = Math.floor((sec % 86400) / 3600),
	    m = Math.floor((sec % 3600) / 60),
	    s = sec % 60;
	if (d > 0) return '%dd %dh %dm'.format(d, h, m);
	if (h > 0) return '%dh %dm %ds'.format(h, m, s);
	if (m > 0) return '%dm %ds'.format(m, s);
	return '%ds'.format(s);
}

function regionLabel(code) {
	if (!code) return '-';
	return REGION_NAMES[code] ? '%s (%s)'.format(REGION_NAMES[code], code) : code;
}

function badge(text, color) {
	return E('span', {
		'style': 'background:%s;color:#fff;padding:2px 10px;border-radius:10px;'.format(color) +
		         'font-weight:bold;white-space:nowrap;display:inline-block'
	}, [ text ]);
}

function stateBadge(st) {
	if (!st.running)  return badge(_('Stopped'), '#8a8a8a');
	if (st.connected) return badge(_('Connected'), '#2e7d32');

	var trying = (st.started > 0 && st.now > 0) ? (st.now - st.started) : 0;
	var b = badge(_('Connecting…'), trying > 120 ? '#c62828' : '#ef6c00');
	if (!trying) return b;

	return E('span', {}, [
		b, ' ',
		E('small', { 'style': 'color:#999' },
			_('trying for %s, %d attempt(s)').format(fmtDuration(trying), st.attempts || 0))
	]);
}

/* Explains a tunnel that will not come up. Psiphon retries forever, so
   without this the page would just say "Connecting..." indefinitely. */
function troubleShooting(st) {
	if (!st.running || st.connected) return null;

	var trying = (st.started > 0 && st.now > 0) ? (st.now - st.started) : 0;
	if (trying < 45) return null;

	var title, body;

	if (st.candidates === 0 || (st.candidates < 0 && !st.serverlist && trying > 90)) {
		title = _('No Psiphon servers to try yet');
		body = [
			E('p', { 'style': 'margin:4px 0' },
				_('Psiphon has not been able to obtain its server list, so it has nothing to connect to. The server list is downloaded on first use, and that download is often what gets blocked first.')),
			E('ul', { 'style': 'margin:4px 0 4px 18px' }, [
				E('li', {}, _('Set Upstream proxy (Advanced) to another proxy that currently works on this router, e.g. socks5://127.0.0.1:10808 - Psiphon will bootstrap through it.')),
				E('li', {}, _('Or provide an embedded server list file (Advanced) copied from a working Psiphon installation.')),
				E('li', {}, _('If the router has no internet at all, fix that first - check Network -> Interfaces.'))
			])
		];
	} else {
		title = _('Servers known, but no tunnel yet');
		body = [
			E('p', { 'style': 'margin:4px 0' },
				_('Psiphon has %d candidate server(s) and keeps trying different servers and protocols. Under heavy filtering this can take several minutes, and it never gives up on its own.').format(st.candidates > 0 ? st.candidates : 0)),
			E('ul', { 'style': 'margin:4px 0 4px 18px' }, [
				E('li', {}, _('Leave Limit tunnel protocols empty so every obfuscation method may be tried.')),
				E('li', {}, _('Set Egress country back to Auto if you forced a country.')),
				E('li', {}, _('Use View notices to see what each attempt reports.')),
				E('li', {}, _('If it still fails, set Upstream proxy (Advanced) to a proxy that works right now.'))
			])
		];
	}

	if (st.last_warning)
		body.push(E('p', { 'style': 'margin:6px 0 0 0' }, [
			E('strong', {}, _('Last message: ')), E('code', {}, st.last_warning)
		]));

	return E('div', {
		'style': 'margin-top:12px;padding:10px 14px;border-left:3px solid #ef6c00;' +
		         'background:rgba(239,108,0,.10);border-radius:4px;max-width:760px'
	}, [ E('h4', { 'style': 'margin:0 0 6px 0' }, title) ].concat(body));
}

function row(label, id, value) {
	return E('div', { 'class': 'cbi-value', 'style': 'margin-bottom:4px' }, [
		E('label', { 'class': 'cbi-value-title', 'style': 'width:220px' }, label),
		E('div', { 'class': 'cbi-value-field', 'id': id }, value)
	]);
}

function set(id, content) {
	var node = document.getElementById(id);
	if (!node) return;
	while (node.firstChild) node.removeChild(node.firstChild);
	if (content instanceof Node) node.appendChild(content);
	else node.appendChild(document.createTextNode(content == null ? '-' : String(content)));
}

function renderState(st) {
	st = st || {};

	var up = (st.connected && st.connected_since > 0)
		? Math.max(0, (st.now || 0) - st.connected_since) : 0;

	set('opsiphon-state', stateBadge(st));

	/* values that only mean something while the tunnel is up */
	set('opsiphon-egress', st.running ? regionLabel(st.server_region) : '-');
	set('opsiphon-client-region', st.running ? regionLabel(st.client_region) : '-');
	set('opsiphon-uptime', fmtDuration(up));
	set('opsiphon-traffic', st.running
		? '↓ %s   ↑ %s'.format(fmtBytes(st.received), fmtBytes(st.sent)) : '-');
	set('opsiphon-proxies', (st.running && (st.socks_port > 0 || st.http_port > 0))
		? 'SOCKS5 127.0.0.1:%d   ·   HTTP 127.0.0.1:%d'.format(st.socks_port || 0, st.http_port || 0)
		: '-');
	set('opsiphon-boot', st.autostart ? _('Enabled') : _('Disabled'));
	set('opsiphon-event', '%s %s'.format(st.last_event || '-', st.last_message || ''));

	var box = document.getElementById('opsiphon-trouble');
	if (box) {
		while (box.firstChild) box.removeChild(box.firstChild);
		var t = troubleShooting(st);
		if (t) box.appendChild(t);
	}

	var c = document.getElementById('opsiphon-btn-connect'),
	    d = document.getElementById('opsiphon-btn-disconnect');
	if (c) c.disabled = !!st.running;
	if (d) d.disabled = !st.running;
}

function doAction(name) {
	return function(ev) {
		var btn = ev.currentTarget;
		btn.classList.add('spinning');
		btn.disabled = true;
		return callAction(name).then(function() {
			return new Promise(function(resolve) { window.setTimeout(resolve, 1500); });
		}).then(function() {
			return callState();
		}).then(function(st) {
			btn.classList.remove('spinning');
			renderState(st);
		}).catch(function(err) {
			btn.classList.remove('spinning');
			btn.disabled = false;
			ui.addNotification(null, E('p', _('Action failed: %s').format(err.message || err)), 'error');
		});
	};
}

function showLog() {
	return callLog(200).then(function(res) {
		var lines = ((res && res.log) ? res.log : '').split('\n').map(function(l) {
			var m = l.match(/^(\d+)\s+(.*)$/);
			if (!m) return l;
			return '%s  %s'.format(new Date(parseInt(m[1]) * 1000).toLocaleTimeString(), m[2]);
		}).reverse().join('\n');

		ui.showModal(_('Psiphon notices'), [
			E('pre', { 'style': 'max-height:60vh;overflow:auto;white-space:pre-wrap;font-size:12px' },
				[ lines || _('No notices yet.') ]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close'))
			])
		]);
	});
}

function usageBox(socksPort, httpPort, listenIface) {
	var host = window.location.hostname || '192.168.1.1';
	var lan = (listenIface && listenIface.length)
		? E('span', {}, [
			_('LAN clients can use the proxy directly at '),
			E('code', {}, '%s:%s'.format(host, socksPort || '1080')),
			_(' (SOCKS5) or '),
			E('code', {}, '%s:%s'.format(host, httpPort || '8080')),
			_(' (HTTP) - the proxies are bound to '),
			E('code', {}, listenIface), '.'
		])
		: E('span', {}, [
			_('The proxies currently listen on the router itself only (127.0.0.1). To let LAN clients use them, set '),
			E('em', {}, _('Listen interface')),
			_(' to '), E('code', {}, 'br-lan'), _(' in the Advanced tab, then point a client at '),
			E('code', {}, '%s:%s'.format(host, socksPort || '1080')), '.'
		]);

	return E('div', {
		'style': 'margin-top:14px;padding:10px 14px;border-left:3px solid #2e7d32;' +
		         'background:rgba(46,125,50,.08);border-radius:4px;max-width:760px'
	}, [
		E('h4', { 'style': 'margin:0 0 6px 0' }, _('How to use the tunnel')),
		E('p', { 'style': 'margin:4px 0' }, [
			E('strong', {}, _('One device / browser: ')), lan
		]),
		E('p', { 'style': 'margin:4px 0' }, [
			E('strong', {}, _('The whole network: ')),
			_('Psiphon only provides the tunnel - forwarding all LAN traffic into it is a separate job. A proxy manager such as PassWall2 or OpenClash can do it: add a node of type '),
			E('code', {}, 'Socks5'), _(' pointing at '),
			E('code', {}, '127.0.0.1:%s'.format(socksPort || '1080')),
			_(' and select it as the active node. It then handles redirection, DNS and bypass rules.')
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			callState().catch(function() { return {}; }),
			uci.load('opsiphon')
		]);
	},

	render: function(data) {
		var st = data[0] || {};

		var socksPort = uci.get('opsiphon', 'config', 'socks_port') || '1080';
		var httpPort = uci.get('opsiphon', 'config', 'http_port') || '8080';
		var listenIface = uci.get('opsiphon', 'config', 'listen_interface') || '';

		var logo = E('img', {
			'src': L.resource('view/opsiphon/logo.png'),
			'alt': 'Psiphon',
			'style': 'width:100%;max-width:420px;height:auto'
		});
		logo.onerror = function() { this.style.display = 'none'; };

		var statusSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Status')),
			E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start' }, [
				E('div', { 'style': 'flex:1 1 460px;min-width:300px' }, [
					row(_('Connection'), 'opsiphon-state', stateBadge(st)),
					row(_('Egress country'), 'opsiphon-egress', '-'),
					row(_('Detected client country'), 'opsiphon-client-region', '-'),
					row(_('Connected for'), 'opsiphon-uptime', '-'),
					row(_('Traffic (down / up)'), 'opsiphon-traffic', '-'),
					row(_('Local proxies'), 'opsiphon-proxies', '-'),
					row(_('Start on boot'), 'opsiphon-boot', '-'),
					row(_('Last event'), 'opsiphon-event', '-'),
					E('div', { 'class': 'cbi-value', 'style': 'margin-top:10px' }, [
						E('label', { 'class': 'cbi-value-title', 'style': 'width:220px' }, ' '),
						E('div', { 'class': 'cbi-value-field' }, [
							E('button', {
								'class': 'btn cbi-button cbi-button-apply',
								'id': 'opsiphon-btn-connect',
								'click': doAction('start')
							}, _('Connect')),
							' ',
							E('button', {
								'class': 'btn cbi-button cbi-button-reset',
								'id': 'opsiphon-btn-disconnect',
								'click': doAction('stop')
							}, _('Disconnect')),
							' ',
							E('button', {
								'class': 'btn cbi-button',
								'click': doAction('restart')
							}, _('Reconnect')),
							' ',
							E('button', {
								'class': 'btn cbi-button',
								'click': ui.createHandlerFn(this, showLog)
							}, _('View notices'))
						])
					])
				]),
				E('div', { 'style': 'flex:0 1 420px;max-width:420px;width:100%;text-align:center' }, [ logo ])
			]),
			E('div', { 'id': 'opsiphon-trouble' }, []),
			usageBox(socksPort, httpPort, listenIface)
		]);

		poll.add(function() {
			return callState().then(renderState).catch(function() {});
		}, 3);

		var m, s, o;

		m = new form.Map('opsiphon', _('Psiphon'),
			_('Psiphon censorship circumvention client. Use the buttons above to connect and disconnect; the settings below apply the next time the tunnel starts.'));

		s = m.section(form.NamedSection, 'config', 'opsiphon');
		s.addremove = false;

		s.tab('general', _('General'));
		s.tab('advanced', _('Advanced'));

		/* ------------------------------------------------------- general */
		o = s.taboption('general', form.Flag, 'autostart', _('Start on boot'),
			_('Re-open the tunnel automatically after the router reboots. Nothing starts on its own until you press Connect once.'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('general', form.ListValue, 'region', _('Egress country'),
			_('Country the traffic leaves the Psiphon network from. "Auto" lets Psiphon pick the best performing server.'));
		o.value('', _('Auto (best available)'));
		var seen = {};
		(st.regions || []).forEach(function(code) {
			if (!code || seen[code]) return;
			seen[code] = true;
			o.value(code, regionLabel(code));
		});
		Object.keys(REGION_NAMES).sort().forEach(function(code) {
			if (!seen[code]) o.value(code, regionLabel(code));
		});

		o = s.taboption('general', form.Value, 'socks_port', _('SOCKS5 port'),
			_('Local SOCKS5 proxy port. 0 disables the SOCKS proxy.'));
		o.datatype = 'port';
		o.default = '1080';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'http_port', _('HTTP proxy port'),
			_('Local HTTP proxy port. 0 disables the HTTP proxy.'));
		o.datatype = 'port';
		o.default = '8080';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'listen_interface', _('Listen interface'),
			_('Bind the proxies to this interface so other devices on the network can use them, e.g. br-lan. Empty keeps them on 127.0.0.1, reachable only from the router itself.'));
		o.placeholder = 'br-lan';
		o.rmempty = true;

		o = s.taboption('general', form.Flag, 'stats', _('Collect traffic statistics'),
			_('Count the bytes going through the tunnel and show them above.'));
		o.default = '1';

		/* ------------------------------------------------------ advanced */
		o = s.taboption('advanced', form.Value, 'data_dir', _('Data directory'),
			_('Where Psiphon keeps its server list and datastore. Move it to external storage (e.g. /mnt/sda1/opsiphon) to spare the router flash.'));
		o.default = '/etc/opsiphon/data';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'establish_timeout', _('Establish timeout (s)'),
			_('Give up trying to build a tunnel after this many seconds and start over. 0 uses the Psiphon default.'));
		o.datatype = 'uinteger';
		o.default = '0';

		o = s.taboption('advanced', form.Value, 'upstream_proxy', _('Upstream proxy'),
			_('Send the tunnel itself through another proxy first, e.g. socks5://127.0.0.1:10808 or http://127.0.0.1:8118. Use this where Psiphon cannot even reach its own servers, but some other proxy on this router still works.'));
		o.placeholder = 'socks5://127.0.0.1:10808';
		o.rmempty = true;

		o = s.taboption('advanced', form.Value, 'server_list_file', _('Embedded server list file'),
			_('Path to a file with Psiphon server entries, e.g. /etc/opsiphon/server_list. With it the tunnel can start without downloading the remote server list first - useful when that download is blocked.'));
		o.placeholder = '/etc/opsiphon/server_list';
		o.rmempty = true;

		o = s.taboption('advanced', form.Flag, 'diagnostics', _('Diagnostic notices'),
			_('Let Psiphon report warnings, errors and candidate server counts. This is what fills in the explanation shown above when a tunnel will not establish. Turn it off only to make the log quieter.'));
		o.default = '1';

		o = s.taboption('advanced', form.MultiValue, 'protocols', _('Limit tunnel protocols'),
			_('Restrict Psiphon to these obfuscation protocols. Leave everything unchecked to allow all of them (recommended - Psiphon picks what gets through).'));
		TUNNEL_PROTOCOLS.forEach(function(p) { o.value(p, p); });
		o.rmempty = true;

		o = s.taboption('advanced', form.DummyValue, '_netinfo', _('Psiphon network'));
		o.rawhtml = false;
		o.cfgvalue = function() {
			return _('The four values below identify this client to the Psiphon network and tell it where to fetch its server list from. The defaults are the public community values published with the open source psiphon-tunnel-core. Change them only if Psiphon Inc. gave you your own sponsor configuration.');
		};

		o = s.taboption('advanced', form.Value, 'sponsor_id', _('Sponsor ID'),
			_('Decides which server set and home page this client is served.'));
		o.default = 'FFFFFFFFFFFFFFFF';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'propagation_id', _('Propagation channel ID'),
			_('Identifies the distribution channel the client came from.'));
		o.default = 'FFFFFFFFFFFFFFFF';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'server_list_url', _('Remote server list URL'),
			_('Where the client bootstraps its list of Psiphon servers from.'));
		o.rmempty = false;

		o = s.taboption('advanced', form.TextValue, 'server_list_key', _('Remote server list signature key'),
			_('Public key used to verify the downloaded server list. Leave empty to use the built-in community key.'));
		o.rows = 4;
		o.rmempty = true;

		var about = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('About')),
			E('p', {}, [
				'Opsiphon %s'.format(OPSIPHON_VERSION), E('br'),
				E('a', { 'href': OPSIPHON_REPO, 'target': '_blank', 'rel': 'noreferrer' }, OPSIPHON_REPO),
				E('br'),
				_('Support / contact: '),
				E('a', { 'href': OPSIPHON_TELEGRAM, 'target': '_blank', 'rel': 'noreferrer' }, 't.me/routekernel1')
			]),
			E('p', { 'style': 'color:#777' }, [
				_('Tunnel engine: psiphon-tunnel-core by Psiphon Labs. Core build: '),
				E('code', {}, st.core_rev || _('unknown'))
			])
		]);

		return m.render().then(function(mapNode) {
			window.setTimeout(function() { renderState(st); }, 0);
			return E([], [ statusSection, mapNode, about ]);
		});
	}
});
