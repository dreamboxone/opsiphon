'use strict';
'require view';
'require form';
'require rpc';
'require poll';
'require ui';
'require uci';

/*
 * luci-app-opsiphon 1.0.0
 * Psiphon for OpenWrt - https://github.com/dreamboxone/opsiphon
 * Support: https://t.me/routekernel1
 */

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

/* Psiphon egress regions. The list is refreshed at runtime from the
   AvailableEgressRegions notice, this is only the offline fallback. */
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
		'style': 'background:%s;color:#fff;padding:2px 8px;border-radius:10px;'.format(color) +
		         'font-weight:bold;white-space:nowrap;display:inline-block'
	}, [ text ]);
}

function stateBadge(st) {
	if (!st.running)   return badge(_('Stopped'), '#8a8a8a');
	if (st.connected)  return badge(_('Connected'), '#2e7d32');
	return badge(_('Connecting…'), '#ef6c00');
}

function row(label, id, value) {
	return E('div', { 'class': 'cbi-value', 'style': 'margin-bottom:4px' }, [
		E('label', { 'class': 'cbi-value-title', 'style': 'width:220px' }, label),
		E('div', { 'class': 'cbi-value-field', 'id': id }, value)
	]);
}

function renderState(st) {
	st = st || {};

	var upSeconds = (st.connected && st.connected_since > 0)
		? Math.max(0, (st.now || 0) - st.connected_since) : 0;

	var set = function(id, content) {
		var node = document.getElementById(id);
		if (!node) return;
		while (node.firstChild) node.removeChild(node.firstChild);
		if (content instanceof Node) node.appendChild(content);
		else node.appendChild(document.createTextNode(content == null ? '-' : String(content)));
	};

	set('opsiphon-state', stateBadge(st));
	set('opsiphon-egress', regionLabel(st.server_region));
	set('opsiphon-client-region', regionLabel(st.client_region));
	set('opsiphon-uptime', fmtDuration(upSeconds));
	set('opsiphon-traffic', '↓ %s   ↑ %s'.format(fmtBytes(st.received), fmtBytes(st.sent)));
	set('opsiphon-proxies', (st.socks_port > 0 || st.http_port > 0)
		? 'SOCKS5 127.0.0.1:%d   HTTP 127.0.0.1:%d'.format(st.socks_port || 0, st.http_port || 0)
		: '-');
	set('opsiphon-event', '%s %s'.format(st.last_event || '-', st.last_message || ''));
	set('opsiphon-boot', st.autostart ? _('Enabled') : _('Disabled'));

	var btnConnect = document.getElementById('opsiphon-btn-connect');
	var btnDisconnect = document.getElementById('opsiphon-btn-disconnect');
	if (btnConnect) btnConnect.disabled = !!st.running;
	if (btnDisconnect) btnDisconnect.disabled = !st.running;
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
			ui.addNotification(null, E('p', _('Opsiphon: %s requested.').format(name)), 'info');
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
			var d = new Date(parseInt(m[1]) * 1000);
			return '%s  %s'.format(d.toLocaleTimeString(), m[2]);
		}).reverse().join('\n');

		ui.showModal(_('Psiphon notices'), [
			E('pre', {
				'style': 'max-height:60vh;overflow:auto;white-space:pre-wrap;font-size:12px'
			}, [ lines || _('No notices yet.') ]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close'))
			])
		]);
	});
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
		var self = this;

		var statusSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Status')),
			row(_('Connection'), 'opsiphon-state', stateBadge(st)),
			row(_('Egress country'), 'opsiphon-egress', regionLabel(st.server_region)),
			row(_('Detected client country'), 'opsiphon-client-region', regionLabel(st.client_region)),
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
		]);

		poll.add(function() {
			return callState().then(renderState).catch(function() {});
		}, 3);

		var m, s, o;

		m = new form.Map('opsiphon', _('Opsiphon'),
			_('Psiphon circumvention client for OpenWrt. The tunnel exposes a local SOCKS5 and HTTP proxy that you can use directly or feed into a router-wide proxy manager such as PassWall2.'));

		s = m.section(form.NamedSection, 'config', 'opsiphon', _('Settings'));
		s.addremove = false;

		s.tab('general', _('General'));
		s.tab('advanced', _('Advanced'));
		s.tab('network', _('Psiphon network'));

		o = s.taboption('general', form.Flag, 'enabled', _('Enable'),
			_('Run the Psiphon tunnel. This is the same switch as the Connect / Disconnect buttons above.'));
		o.rmempty = false;

		o = s.taboption('general', form.Flag, 'autostart', _('Start on boot'),
			_('Start the tunnel automatically when the router boots.'));
		o.rmempty = false;

		o = s.taboption('general', form.ListValue, 'region', _('Egress country'),
			_('Exit country of the tunnel. "Auto" lets Psiphon pick the best performing server.'));
		o.value('', _('Auto (best available)'));
		var seen = {};
		(st.regions || []).forEach(function(code) {
			if (!code || seen[code]) return;
			seen[code] = true;
			o.value(code, regionLabel(code));
		});
		Object.keys(REGION_NAMES).sort().forEach(function(code) {
			if (seen[code]) return;
			o.value(code, regionLabel(code));
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

		o = s.taboption('general', form.Flag, 'stats', _('Collect traffic statistics'),
			_('Enables the Psiphon bytes-transferred notices used by the traffic counters above.'));
		o.default = '1';

		o = s.taboption('advanced', form.Value, 'listen_interface', _('Listen interface'),
			_('Bind the local proxies to this interface so LAN clients can use them directly (e.g. br-lan). Empty keeps the proxies on 127.0.0.1 only.'));
		o.placeholder = 'br-lan';
		o.rmempty = true;

		o = s.taboption('advanced', form.Value, 'data_dir', _('Data directory'),
			_('Where Psiphon stores its server list and datastore. Move it to external storage (e.g. /mnt/sda1/opsiphon) to reduce writes to the router flash.'));
		o.default = '/etc/opsiphon/data';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'establish_timeout', _('Establish timeout (s)'),
			_('Give up establishing a tunnel after this many seconds. 0 uses the Psiphon default.'));
		o.datatype = 'uinteger';
		o.default = '0';

		o = s.taboption('advanced', form.MultiValue, 'protocols', _('Limit tunnel protocols'),
			_('Restrict Psiphon to these tunnel protocols. Leave empty to allow all (recommended).'));
		TUNNEL_PROTOCOLS.forEach(function(p) { o.value(p, p); });
		o.rmempty = true;

		s = m.section(form.NamedSection, 'network', 'psiphon', _('Psiphon network'),
			_('These values identify the client to the Psiphon network. The defaults are the public community values shipped with the open source psiphon-tunnel-core sample configuration. Replace them only if Psiphon Inc. gave you your own sponsor configuration.'));
		s.addremove = false;

		o = s.option(form.Value, 'sponsor_id', _('Sponsor ID'));
		o.default = 'FFFFFFFFFFFFFFFF';
		o.rmempty = false;

		o = s.option(form.Value, 'propagation_id', _('Propagation channel ID'));
		o.default = 'FFFFFFFFFFFFFFFF';
		o.rmempty = false;

		o = s.option(form.Value, 'server_list_url', _('Remote server list URL'));
		o.rmempty = false;

		o = s.option(form.TextValue, 'server_list_key', _('Remote server list signature key'),
			_('Leave empty to use the built-in community key.'));
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
				_('Tunnel engine: psiphon-tunnel-core (Psiphon Labs). Core build: '),
				E('code', {}, st.core_rev || _('unknown'))
			])
		]);

		return m.render().then(function(mapNode) {
			window.setTimeout(function() { renderState(st); }, 0);
			return E([], [ statusSection, mapNode, about ]);
		});
	}
});
