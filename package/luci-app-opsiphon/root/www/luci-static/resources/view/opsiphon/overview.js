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

var OPSIPHON_VERSION = '1.0.4';
var OPSIPHON_TELEGRAM = 'https://t.me/routekernel1';
var OPSIPHON_REPO = 'https://github.com/dreamboxone/opsiphon';

var C = {
	green:  '#10b981',
	teal:   '#0d9488',
	blue:   '#3b82f6',
	amber:  '#f59e0b',
	red:    '#ef4444',
	grey:   '#94a3b8',
	violet: '#8b5cf6'
};

var callState    = rpc.declare({ object: 'luci.opsiphon', method: 'state',    expect: { '': {} } });
var callUsage    = rpc.declare({ object: 'luci.opsiphon', method: 'usage',    expect: { '': {} } });
var callPasswall = rpc.declare({ object: 'luci.opsiphon', method: 'passwall', expect: { '': {} } });
var callRules    = rpc.declare({ object: 'luci.opsiphon', method: 'rules',    expect: { '': {} } });
var callLog      = rpc.declare({ object: 'luci.opsiphon', method: 'log',    params: [ 'lines' ], expect: { '': {} } });
var callAction   = rpc.declare({ object: 'luci.opsiphon', method: 'action', params: [ 'name' ],  expect: { '': {} } });

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

/* ------------------------------------------------------------ formatting */

function fmtBytes(n) {
	n = parseInt(n) || 0;
	var u = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], i = 0;
	while (n >= 1024 && i < u.length - 1) { n = n / 1024; i++; }
	return (i === 0 ? n : n.toFixed(n < 10 ? 2 : 1)) + ' ' + u[i];
}

function fmtDuration(sec) {
	sec = parseInt(sec) || 0;
	if (sec <= 0) return '-';
	var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600),
	    m = Math.floor((sec % 3600) / 60), s = sec % 60;
	if (d > 0) return '%dd %dh %dm'.format(d, h, m);
	if (h > 0) return '%dh %dm %ds'.format(h, m, s);
	if (m > 0) return '%dm %ds'.format(m, s);
	return '%ds'.format(s);
}

function fmtAge(mtime, now) {
	if (!mtime) return _('never');
	var age = Math.max(0, (now || Math.floor(Date.now() / 1000)) - mtime);
	if (age < 3600) return _('%d min ago').format(Math.floor(age / 60));
	if (age < 86400) return _('%d h ago').format(Math.floor(age / 3600));
	return _('%d d ago').format(Math.floor(age / 86400));
}

function regionLabel(code) {
	if (!code) return '-';
	return REGION_NAMES[code] ? '%s (%s)'.format(REGION_NAMES[code], code) : code;
}

/* --------------------------------------------------------------- widgets */

function card(title, colour, body, headerExtra) {
	return E('div', {
		'style': 'background:rgba(127,127,127,.06);border:1px solid rgba(127,127,127,.20);' +
		         'border-top:3px solid %s;border-radius:8px;padding:14px 16px;margin:0 0 16px 0'.format(colour)
	}, [
		E('div', { 'style': 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap' }, [
			E('h3', { 'style': 'margin:0;font-size:16px;color:%s'.format(colour) }, title),
			headerExtra || E('span', {}, '')
		]),
		body
	]);
}

function pill(text, colour) {
	return E('span', {
		'style': 'background:%s;color:#fff;padding:3px 12px;border-radius:12px;'.format(colour) +
		         'font-weight:bold;white-space:nowrap;display:inline-block;font-size:12px'
	}, [ text ]);
}

function tile(label, id, colour) {
	return E('div', {
		'style': 'flex:1 1 130px;min-width:120px;background:rgba(127,127,127,.07);' +
		         'border-left:3px solid %s;border-radius:6px;padding:8px 12px'.format(colour)
	}, [
		E('div', { 'style': 'font-size:11px;text-transform:uppercase;letter-spacing:.5px;opacity:.7' }, label),
		E('div', { 'id': id, 'style': 'font-size:17px;font-weight:600;margin-top:2px;color:%s'.format(colour) }, '-')
	]);
}

function row(label, id, value) {
	return E('div', { 'style': 'display:flex;gap:10px;padding:3px 0;align-items:baseline;flex-wrap:wrap' }, [
		E('span', { 'style': 'flex:0 0 190px;opacity:.75' }, label),
		E('span', { 'style': 'flex:1 1 auto;font-weight:500', 'id': id }, value)
	]);
}

/* SVG must be built as markup: LuCI's E() creates HTML elements, which would
   land in the wrong XML namespace and render as nothing. */
function svgBox(markup, style) {
	var d = E('div', { 'style': style || '' });
	d.innerHTML = markup;
	return d;
}

function donut(recv, sent) {
	recv = recv || 0; sent = sent || 0;
	var total = recv + sent, r = 62, circ = 2 * Math.PI * r,
	    gap = total > 0 ? 4 : 0,
	    rl = total > 0 ? Math.max(0, (recv / total) * circ - gap) : 0,
	    sl = total > 0 ? Math.max(0, (sent / total) * circ - gap) : 0;

	var arcs = '';
	if (total > 0) {
		arcs += '<circle cx="80" cy="80" r="62" fill="none" stroke="' + C.green + '" stroke-width="20" ' +
		        'stroke-dasharray="' + rl.toFixed(2) + ' ' + (circ - rl).toFixed(2) + '" ' +
		        'transform="rotate(-90 80 80)"/>';
		arcs += '<circle cx="80" cy="80" r="62" fill="none" stroke="' + C.blue + '" stroke-width="20" ' +
		        'stroke-dasharray="' + sl.toFixed(2) + ' ' + (circ - sl).toFixed(2) + '" ' +
		        'stroke-dashoffset="' + (-(rl + gap)).toFixed(2) + '" transform="rotate(-90 80 80)"/>';
	}

	return svgBox(
		'<svg viewBox="0 0 160 160" style="width:150px;height:150px;display:block">' +
		'<circle cx="80" cy="80" r="62" fill="none" stroke="rgba(127,127,127,.15)" stroke-width="20"/>' +
		arcs +
		'<text x="80" y="78" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor">' +
			fmtBytes(total) + '</text>' +
		'<text x="80" y="96" text-anchor="middle" font-size="11" fill="currentColor" opacity=".6">' +
			_('total') + '</text></svg>', 'color:inherit');
}

function bars(days) {
	days = (days || []).slice(-14);
	if (!days.length)
		return E('div', { 'style': 'opacity:.6;padding:8px 0;font-size:13px' }, _('No history yet.'));

	var max = 1;
	days.forEach(function(d) { max = Math.max(max, (d.sent || 0) + (d.received || 0)); });

	var w = 26, h = 90;
	var markup = '<svg viewBox="0 0 ' + (days.length * w) + ' ' + (h + 22) +
	             '" preserveAspectRatio="none" style="width:100%;height:110px">';

	days.forEach(function(d, i) {
		var recv = d.received || 0, sent = d.sent || 0,
		    rh = Math.round((recv / max) * h), sh = Math.round((sent / max) * h),
		    x = i * w + 4,
		    label = (d.date || '') + '  ↓ ' + fmtBytes(recv) + '  ↑ ' + fmtBytes(sent);
		markup += '<rect x="' + x + '" y="' + (h - rh) + '" width="' + (w - 8) + '" height="' + rh +
		          '" fill="' + C.green + '" rx="2"><title>' + label + '</title></rect>';
		markup += '<rect x="' + x + '" y="' + (h - rh - sh) + '" width="' + (w - 8) + '" height="' + sh +
		          '" fill="' + C.blue + '" rx="2"><title>' + label + '</title></rect>';
		markup += '<text x="' + (x + (w - 8) / 2) + '" y="' + (h + 14) +
		          '" text-anchor="middle" font-size="9" fill="currentColor" opacity=".55">' +
		          (d.date || '').slice(5) + '</text>';
	});

	return svgBox(markup + '</svg>', 'color:inherit');
}

function legend() {
	return E('div', { 'style': 'display:flex;gap:16px;font-size:12px;opacity:.85;margin-top:6px' }, [
		E('span', {}, [ E('span', { 'style': 'display:inline-block;width:10px;height:10px;border-radius:2px;background:%s;margin-right:5px'.format(C.green) }), _('Download') ]),
		E('span', {}, [ E('span', { 'style': 'display:inline-block;width:10px;height:10px;border-radius:2px;background:%s;margin-right:5px'.format(C.blue) }), _('Upload') ])
	]);
}

/* ---------------------------------------------------------------- status */

function stateBadge(st) {
	if (!st.running)  return pill(_('Stopped'), C.grey);
	if (st.connected) return pill(_('Connected'), C.green);

	var trying = (st.started > 0 && st.now > 0) ? (st.now - st.started) : 0;
	var b = pill(_('Connecting…'), trying > 120 ? C.red : C.amber);
	if (!trying) return b;
	return E('span', {}, [ b, ' ', E('small', { 'style': 'opacity:.7' },
		_('trying for %s, %d attempt(s)').format(fmtDuration(trying), st.attempts || 0)) ]);
}

function troubleShooting(st) {
	if (!st.running || st.connected) return null;
	var trying = (st.started > 0 && st.now > 0) ? (st.now - st.started) : 0;
	if (trying < 45) return null;

	var title, body;
	if (st.candidates === 0 || (st.candidates < 0 && !st.serverlist && trying > 90)) {
		title = _('No Psiphon servers to try yet');
		body = [
			E('p', { 'style': 'margin:4px 0' },
				_('Psiphon could not download its server list, so it has nothing to connect to. That download is usually the first thing a filter blocks.')),
			E('ul', { 'style': 'margin:4px 0 4px 18px' }, [
				E('li', {}, _('Set Upstream proxy (Advanced) to a proxy that works here right now, e.g. socks5://127.0.0.1:10808 - Psiphon will bootstrap through it.')),
				E('li', {}, _('Or point Embedded server list file (Advanced) at server entries from a working Psiphon installation.')),
				E('li', {}, _('If the router has no internet at all, fix that first.'))
			])
		];
	} else {
		title = _('Servers known, but no tunnel yet');
		body = [
			E('p', { 'style': 'margin:4px 0' },
				_('Psiphon has %d candidate server(s) and keeps trying servers and protocols. Under heavy filtering this can take minutes.').format(st.candidates > 0 ? st.candidates : 0)),
			E('ul', { 'style': 'margin:4px 0 4px 18px' }, [
				E('li', {}, _('Leave Limit tunnel protocols empty.')),
				E('li', {}, _('Set Country back to Auto.')),
				E('li', {}, _('Open Logs to see what each attempt reports.'))
			])
		];
	}
	if (st.last_warning)
		body.push(E('p', { 'style': 'margin:6px 0 0 0' }, [
			E('strong', {}, _('Last message: ')), E('code', {}, st.last_warning) ]));

	return E('div', {
		'style': 'margin:0 0 16px 0;padding:10px 14px;border-left:3px solid %s;'.format(C.amber) +
		         'background:rgba(245,158,11,.10);border-radius:4px'
	}, [ E('h4', { 'style': 'margin:0 0 6px 0' }, title) ].concat(body));
}

function setNode(id, content) {
	var n = document.getElementById(id);
	if (!n) return;
	while (n.firstChild) n.removeChild(n.firstChild);
	if (content instanceof Node) n.appendChild(content);
	else n.appendChild(document.createTextNode(content == null ? '-' : String(content)));
}

function renderState(st) {
	st = st || {};
	var up = (st.connected && st.connected_since > 0) ? Math.max(0, (st.now || 0) - st.connected_since) : 0;

	setNode('ops-state', stateBadge(st));
	setNode('ops-egress', st.running ? regionLabel(st.server_region) : '-');
	setNode('ops-client', st.running ? regionLabel(st.client_region) : '-');
	setNode('ops-uptime', fmtDuration(up));
	setNode('ops-session', st.running ? '↓ %s   ↑ %s'.format(fmtBytes(st.received), fmtBytes(st.sent)) : '-');
	setNode('ops-proxies', (st.running && (st.socks_port > 0 || st.http_port > 0))
		? 'SOCKS5 127.0.0.1:%d   ·   HTTP 127.0.0.1:%d'.format(st.socks_port || 0, st.http_port || 0) : '-');
	setNode('ops-boot', st.autostart ? _('Enabled') : _('Disabled'));
	/* Not the raw notice stream. last_event is whatever notice arrived last and
	   last_message is whatever was worth saying last; pasting the two together
	   produced lines like "ConnectingServer psiphon.(*MeekConn).relay#1425: EOF",
	   which is a notice type welded to an unrelated stale trace. The collector
	   now only fills last_message when there is something the reader can act
	   on, so show that when it exists and plain state otherwise. */
	setNode('ops-status', st.last_message ? st.last_message
		: (!st.running ? _('Stopped')
		: (st.connected ? _('Connected') : _('Waiting to connect'))));

	var box = document.getElementById('ops-trouble');
	if (box) {
		while (box.firstChild) box.removeChild(box.firstChild);
		var t = troubleShooting(st);
		if (t) box.appendChild(t);
	}

	var c = document.getElementById('ops-btn-connect'), d = document.getElementById('ops-btn-disconnect');
	if (c) c.disabled = !!st.running;
	if (d) d.disabled = !st.running;
}

function renderUsage(u) {
	u = u || {};
	var period = window._opsPeriod || 'today';
	var sel = u[period] || { sent: 0, received: 0 };

	setNode('ops-donut', donut(sel.received, sel.sent));
	setNode('ops-donut-label', period === 'today' ? _('Today')
		: period === 'week' ? _('Last 7 days')
		: period === 'month' ? _('Last 30 days') : _('All time'));
	setNode('ops-donut-detail', E('div', { 'style': 'display:flex;gap:14px;justify-content:center;font-size:13px;margin-top:4px' }, [
		E('span', { 'style': 'color:%s'.format(C.green) }, '↓ ' + fmtBytes(sel.received)),
		E('span', { 'style': 'color:%s'.format(C.blue) }, '↑ ' + fmtBytes(sel.sent))
	]));

	function tot(o) { return ((o || {}).sent || 0) + ((o || {}).received || 0); }
	setNode('ops-t-today', fmtBytes(tot(u.today)));
	setNode('ops-t-week',  fmtBytes(tot(u.week)));
	setNode('ops-t-month', fmtBytes(tot(u.month)));
	setNode('ops-t-total', fmtBytes(tot(u.total)));
	setNode('ops-bars', bars(u.days));
}

function renderPasswall(pw) {
	pw = pw || {};
	var body;

	if (!pw.installed) {
		body = E('div', {}, [
			pill(_('Not installed'), C.grey), ' ',
			E('span', { 'style': 'opacity:.8' },
				_('PassWall2 was not found on this router. It is what can push the whole LAN through the tunnel and keep Iranian traffic off it.'))
		]);
	} else {
		var mismatch = pw.node && pw.node_port && pw.expected_port && pw.node_port != pw.expected_port;
		body = E('div', {}, [
			E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px' }, [
				pill(_('Installed'), C.green),
				pw.running ? pill(_('Running'), C.teal) : pill(_('Stopped'), C.grey),
				pw.node ? pill(_('Node: socks 127.0.0.1:%s').format(pw.node_port), C.blue)
				        : pill(_('No Opsiphon node yet'), C.amber),
				pw.active ? pill(_('Active node'), C.violet) : E('span', {}, ''),
				pw.iran_direct ? pill(_('Iran traffic: direct'), C.green)
				               : pill(_('Iran traffic: through tunnel'), C.amber)
			]),
			mismatch ? E('p', { 'style': 'color:%s;margin:4px 0'.format(C.amber) },
				_('The node points at port %s but Psiphon listens on %s — press Create / refresh node.')
					.format(pw.node_port, pw.expected_port)) : E('span', {}, ''),
			E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-apply', 'click': doAction('pw_sync') }, _('Create / refresh node')),
				E('button', { 'class': 'btn cbi-button', 'click': doAction('pw_activate') }, _('Use as active node')),
				pw.iran_direct
					? E('button', { 'class': 'btn cbi-button', 'click': doAction('pw_iran_off') }, _('Send Iran traffic through tunnel'))
					: E('button', { 'class': 'btn cbi-button cbi-button-apply', 'click': doAction('pw_iran_on') }, _('Keep Iran traffic direct')),
				E('button', { 'class': 'btn cbi-button cbi-button-remove', 'click': doAction('pw_remove') }, _('Remove node'))
			]),
			E('p', { 'style': 'margin:8px 0 0 0;font-size:12px;opacity:.7' },
				_('Every change backs up /etc/config/passwall2 into /etc/opsiphon/backup first.'))
		]);
	}
	setNode('ops-pw', body);
}

function renderRules(r) {
	r = r || {};
	var gi = r.geoip || {}, gs = r.geosite || {};
	var ok = (gi.size > 0 && gs.size > 0);
	var job = r.job || {};
	var busy = (job.state === 'running');

	setNode('ops-rules', E('div', {}, [
		E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;align-items:center' }, [
			busy ? pill(_('Downloading…'), C.blue)
			     : (ok ? pill(_('Installed'), C.green) : pill(_('Not downloaded'), C.amber)),
			(job.state === 'error') ? pill(_('Last attempt failed'), C.red) : E('span', {}, ''),
			E('code', { 'style': 'opacity:.75' }, r.dir || '')
		]),
		(busy || job.state === 'error')
			? E('p', { 'style': 'margin:4px 0;font-size:13px;opacity:.85' }, job.message || '')
			: E('span', {}, ''),
		E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:10px' }, [
			E('div', { 'style': 'flex:1 1 180px;background:rgba(127,127,127,.07);border-left:3px solid %s;border-radius:6px;padding:8px 12px'.format(gi.size ? C.green : C.grey) }, [
				E('div', { 'style': 'font-size:11px;text-transform:uppercase;opacity:.7' }, 'geoip.dat'),
				E('div', { 'style': 'font-size:14px;font-weight:600;margin-top:2px' },
					gi.size ? '%s · %s'.format(fmtBytes(gi.size), fmtAge(gi.mtime, r.now)) : _('missing'))
			]),
			E('div', { 'style': 'flex:1 1 180px;background:rgba(127,127,127,.07);border-left:3px solid %s;border-radius:6px;padding:8px 12px'.format(gs.size ? C.green : C.grey) }, [
				E('div', { 'style': 'font-size:11px;text-transform:uppercase;opacity:.7' }, 'geosite.dat'),
				E('div', { 'style': 'font-size:14px;font-weight:600;margin-top:2px' },
					gs.size ? '%s · %s'.format(fmtBytes(gs.size), fmtAge(gs.mtime, r.now)) : _('missing'))
			])
		]),
		E('div', { 'style': 'margin-top:10px' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'disabled': busy ? 'disabled' : null,
				'click': doAction('rules_update')
			}, busy ? _('Downloading…') : (ok ? _('Update Iran rules') : _('Download Iran rules')))
		]),
		E('p', { 'style': 'margin:6px 0 0 0;font-size:12px;opacity:.7' },
			_('The download runs in the background — this panel updates by itself when it finishes.')),
		E('p', { 'style': 'margin:8px 0 0 0;font-size:12px;opacity:.7' },
			_('Iran-v2ray-rules data (geoip:ir / geosite:ir). The proxy manager uses them — Psiphon itself has no routing rules — and they are what keeps Iranian traffic off the tunnel.'))
	]));
}

/* --------------------------------------------------------------- actions */

function refreshAll() {
	return Promise.all([
		callState().catch(function() { return {}; }),
		callUsage().catch(function() { return {}; }),
		callPasswall().catch(function() { return {}; }),
		callRules().catch(function() { return {}; })
	]).then(function(d) {
		renderState(d[0]); renderUsage(d[1]); renderPasswall(d[2]); renderRules(d[3]);
		return d;
	});
}

function doAction(name, waitMs) {
	return function(ev) {
		var btn = ev.currentTarget;
		btn.classList.add('spinning');
		btn.disabled = true;
		return callAction(name).then(function(res) {
			if (res && res.output)
				ui.addNotification(null, E('pre', { 'style': 'white-space:pre-wrap;margin:0' }, res.output),
					(res.ok === false) ? 'error' : 'info');
			else if (res && res.ok === false)
				ui.addNotification(null, E('p', _('Action failed: %s').format(name)), 'error');
			return new Promise(function(r) { window.setTimeout(r, waitMs || 1500); });
		}).then(refreshAll).then(function() {
			btn.classList.remove('spinning');
			btn.disabled = false;
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
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close')) ])
		]);
	});
}

function periodButton(key, label) {
	var b = E('button', {
		'class': 'btn cbi-button' + (window._opsPeriod === key ? ' cbi-button-apply' : ''),
		'style': 'padding:2px 12px;font-size:12px',
		'click': function(ev) {
			window._opsPeriod = key;
			var parent = ev.currentTarget.parentNode;
			Array.prototype.forEach.call(parent.querySelectorAll('button'), function(x) {
				x.classList.remove('cbi-button-apply');
			});
			ev.currentTarget.classList.add('cbi-button-apply');
			callUsage().then(renderUsage).catch(function() {});
		}
	}, label);
	return b;
}

function howToBox(socksPort, httpPort, listenIface) {
	var host = window.location.hostname || '192.168.1.1';
	var lan = (listenIface && listenIface.length)
		? E('span', {}, [ _('LAN clients can use '), E('code', {}, '%s:%s'.format(host, socksPort)),
			_(' (SOCKS5) or '), E('code', {}, '%s:%s'.format(host, httpPort)), _(' (HTTP) directly.') ])
		: E('span', {}, [ _('The proxies listen on the router itself only. Set '), E('em', {}, _('Listen interface')),
			_(' to '), E('code', {}, 'br-lan'), _(' to let LAN clients use '),
			E('code', {}, '%s:%s'.format(host, socksPort)), _(' directly.') ]);

	return E('div', {
		'style': 'margin:0 0 16px 0;padding:10px 14px;border-left:3px solid %s;'.format(C.teal) +
		         'background:rgba(13,148,136,.10);border-radius:4px'
	}, [
		E('h4', { 'style': 'margin:0 0 6px 0' }, _('How to use the tunnel')),
		E('p', { 'style': 'margin:4px 0' }, [ E('strong', {}, _('One device: ')), lan ]),
		E('p', { 'style': 'margin:4px 0' }, [ E('strong', {}, _('The whole network: ')),
			_('use the PassWall2 panel above — it points PassWall2 at this tunnel and can keep Iranian traffic off it.') ])
	]);
}

/* ------------------------------------------------------------------ view */

return view.extend({
	load: function() {
		return Promise.all([
			callState().catch(function() { return {}; }),
			uci.load('opsiphon'),
			callUsage().catch(function() { return {}; }),
			callPasswall().catch(function() { return {}; }),
			callRules().catch(function() { return {}; })
		]);
	},

	render: function(data) {
		var st = data[0] || {};
		var socksPort = uci.get('opsiphon', 'config', 'socks_port') || '1080';
		var httpPort = uci.get('opsiphon', 'config', 'http_port') || '8080';
		var listenIface = uci.get('opsiphon', 'config', 'listen_interface') || '';

		if (!window._opsPeriod) window._opsPeriod = 'today';

		var logo = E('img', {
			'src': L.resource('view/opsiphon/logo.png'),
			'alt': 'Psiphon',
			'style': 'width:100%;max-width:140px;height:auto;filter:drop-shadow(0 2px 6px rgba(0,0,0,.25))'
		});
		logo.onerror = function() { this.style.display = 'none'; };

		var statusCard = card(_('Tunnel'), C.teal,
			E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start' }, [
				E('div', { 'style': 'flex:1 1 420px;min-width:280px' }, [
					row(_('Connection'), 'ops-state', stateBadge(st)),
					row(_('Country'), 'ops-egress', '-'),
					row(_('Detected client country'), 'ops-client', '-'),
					row(_('Connected for'), 'ops-uptime', '-'),
					row(_('This session (down / up)'), 'ops-session', '-'),
					row(_('Local proxies'), 'ops-proxies', '-'),
					row(_('Start on boot'), 'ops-boot', '-'),
					row(_('Status'), 'ops-status', '-'),
					E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px' }, [
						E('button', { 'class': 'btn cbi-button cbi-button-apply', 'id': 'ops-btn-connect', 'click': doAction('start', 2500) }, _('Connect')),
						E('button', { 'class': 'btn cbi-button cbi-button-reset', 'id': 'ops-btn-disconnect', 'click': doAction('stop') }, _('Disconnect')),
						E('button', { 'class': 'btn cbi-button', 'click': doAction('restart', 2500) }, _('Reconnect')),
						E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, showLog) }, _('Logs'))
					])
				]),
				E('div', { 'style': 'flex:0 0 auto;text-align:center' }, [ logo ])
			]),
			E('small', { 'style': 'opacity:.6' }, 'v' + OPSIPHON_VERSION));

		var troubleSlot = E('div', { 'id': 'ops-trouble' }, []);

		var trafficCard = card(_('Traffic'), C.green,
			E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:24px;align-items:center' }, [
				E('div', { 'style': 'text-align:center;flex:0 0 auto' }, [
					E('div', { 'id': 'ops-donut' }, [ donut(0, 0) ]),
					E('div', { 'id': 'ops-donut-label', 'style': 'font-size:12px;opacity:.7;margin-top:4px' }, _('Today')),
					E('div', { 'id': 'ops-donut-detail' }, [])
				]),
				E('div', { 'style': 'flex:1 1 320px;min-width:280px' }, [
					E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:10px' }, [
						tile(_('Today'), 'ops-t-today', C.green),
						tile(_('7 days'), 'ops-t-week', C.teal),
						tile(_('30 days'), 'ops-t-month', C.blue),
						tile(_('All time'), 'ops-t-total', C.violet)
					]),
					E('div', { 'id': 'ops-bars', 'style': 'margin-top:12px' }, [ bars([]) ]),
					legend()
				])
			]),
			E('div', { 'id': 'ops-period-row', 'style': 'display:flex;gap:4px' }, [
				periodButton('today', _('Today')),
				periodButton('week', _('7d')),
				periodButton('month', _('30d')),
				periodButton('total', _('All'))
			]));

		var pwCard = card(_('PassWall2 integration'), C.violet, E('div', { 'id': 'ops-pw' }, []));
		var rulesCard = card(_('Iran routing rules'), C.amber, E('div', { 'id': 'ops-rules' }, []));

		poll.add(refreshAll, 5);

		var m, s, o;
		m = new form.Map('opsiphon', _('Settings'),
			_('Settings apply the next time the tunnel starts — press Reconnect after saving.'));

		s = m.section(form.NamedSection, 'config', 'opsiphon');
		s.addremove = false;
		s.tab('general', _('General'));
		s.tab('advanced', _('Advanced'));

		o = s.taboption('general', form.Flag, 'autostart', _('Start on boot'),
			_('Re-open the tunnel automatically after the router reboots.'));
		o.default = '0'; o.rmempty = false;

		o = s.taboption('general', form.ListValue, 'region', _('Country'),
			_('Country the traffic leaves the Psiphon network from. Auto lets Psiphon pick the fastest server.'));
		o.value('', _('Auto (best available)'));
		var seen = {};
		(st.regions || []).forEach(function(c) { if (c && !seen[c]) { seen[c] = 1; o.value(c, regionLabel(c)); } });
		Object.keys(REGION_NAMES).sort().forEach(function(c) { if (!seen[c]) o.value(c, regionLabel(c)); });

		o = s.taboption('general', form.Value, 'socks_port', _('SOCKS5 port'), _('0 disables it.'));
		o.datatype = 'port'; o.default = '1080'; o.rmempty = false;

		o = s.taboption('general', form.Value, 'http_port', _('HTTP proxy port'), _('0 disables it.'));
		o.datatype = 'port'; o.default = '8080'; o.rmempty = false;

		o = s.taboption('general', form.Value, 'listen_interface', _('Listen interface'),
			_('Bind the proxies to this interface so LAN clients can use them, e.g. br-lan. Empty = router only.'));
		o.placeholder = 'br-lan'; o.rmempty = true;

		o = s.taboption('general', form.Flag, 'stats', _('Collect traffic statistics'),
			_('Feeds the traffic counters and the daily history.'));
		o.default = '1';

		o = s.taboption('general', form.Flag, 'passwall_integration', _('Keep a PassWall2 node in sync'),
			_('When PassWall2 is installed, create and refresh a SOCKS node pointing at this tunnel every time it starts. The node is never activated on its own.'));
		o.default = '1';

		o = s.taboption('advanced', form.Value, 'data_dir', _('Data directory'),
			_('Psiphon server list, datastore and the traffic history. Move it to external storage to spare the flash.'));
		o.default = '/etc/opsiphon/data'; o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'establish_timeout', _('Establish timeout (s)'),
			_('Give up a connection attempt after N seconds. 0 = Psiphon default.'));
		o.datatype = 'uinteger'; o.default = '0';

		o = s.taboption('advanced', form.Value, 'upstream_proxy', _('Upstream proxy'),
			_('Send the tunnel itself through another proxy first, e.g. socks5://127.0.0.1:10808. Use it when Psiphon cannot even reach its own servers.'));
		o.placeholder = 'socks5://127.0.0.1:10808'; o.rmempty = true;

		o = s.taboption('advanced', form.Value, 'server_list_file', _('Embedded server list file'),
			_('Server entries to start from, so no server list has to be downloaded first.'));
		o.placeholder = '/etc/opsiphon/server_list'; o.rmempty = true;

		o = s.taboption('advanced', form.Flag, 'diagnostics', _('Diagnostic notices'),
			_('Psiphon reports warnings, errors and candidate server counts. This is what explains a failed connection.'));
		o.default = '1';

		o = s.taboption('advanced', form.MultiValue, 'protocols', _('Limit tunnel protocols'),
			_('Leave everything unchecked to allow all of them (recommended).'));
		TUNNEL_PROTOCOLS.forEach(function(p) { o.value(p, p); });
		o.rmempty = true;

		/* Empty is the normal state for these three: the scripts behind them
		   already carry the same defaults, so an empty setting means "use the
		   built-in one". They were marked required with nothing to fall back
		   on, which left the form permanently invalid and unsaveable. Show the
		   default as a placeholder instead. */
		o = s.taboption('advanced', form.Value, 'geoip_url', _('geoip.dat URL'),
			_('Routing data carrying the geoip:ir category, fetched by the Iran routing rules panel. Leave empty for the default.'));
		o.placeholder = 'https://github.com/chocolate4u/Iran-v2ray-rules/releases/latest/download/geoip.dat';
		o.rmempty = true;

		o = s.taboption('advanced', form.Value, 'geosite_url', _('geosite.dat URL'),
			_('Routing data carrying the geosite:ir category. Leave empty for the default.'));
		o.placeholder = 'https://github.com/chocolate4u/Iran-v2ray-rules/releases/latest/download/geosite.dat';
		o.rmempty = true;

		o = s.taboption('advanced', form.Value, 'asset_dir', _('Routing data directory'),
			_('Where those files go when PassWall2 does not say otherwise.'));
		o.default = '/usr/share/v2ray/';

		o = s.taboption('advanced', form.DummyValue, '_netinfo', _('Psiphon network'));
		o.cfgvalue = function() {
			return _('The values below identify this client to the Psiphon network. The defaults are the public community values from the open source psiphon-tunnel-core. Change them only if Psiphon Inc. gave you your own sponsor configuration.');
		};

		o = s.taboption('advanced', form.Value, 'sponsor_id', _('Sponsor ID'));
		o.default = 'FFFFFFFFFFFFFFFF'; o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'propagation_id', _('Propagation channel ID'));
		o.default = 'FFFFFFFFFFFFFFFF'; o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'server_list_url', _('Remote server list URL'),
			_('Where Psiphon fetches its server list. Leave empty for the default.'));
		o.placeholder = 'https://s3.amazonaws.com/psiphon/web/mjr4-p23r-puwl/server_list_compressed';
		o.rmempty = true;

		o = s.taboption('advanced', form.DynamicList, 'server_list_urls', _('Bootstrap mirrors'),
			_('Locations to fetch the server list from, tried alongside the URL above. A fresh client has no servers until it downloads that list, and where the original location is blocked nothing can start - a reachable mirror fixes that. Safe by design: the list is RSA signed and verified with the key below, so a mirror can only serve an older copy, never a forged one.'));
		o.placeholder = 'https://raw.githubusercontent.com/…/mirror/server_list_compressed';
		o.rmempty = true;

		o = s.taboption('advanced', form.TextValue, 'server_list_key', _('Remote server list signature key'),
			_('Empty = built-in community key.'));
		o.rows = 4; o.rmempty = true;

		var about = E('div', { 'style': 'opacity:.75;font-size:12px;margin-top:10px' }, [
			E('span', {}, 'Opsiphon %s · '.format(OPSIPHON_VERSION)),
			E('a', { 'href': OPSIPHON_REPO, 'target': '_blank', 'rel': 'noreferrer' }, 'github.com/dreamboxone/opsiphon'),
			E('span', {}, ' · '),
			E('a', { 'href': OPSIPHON_TELEGRAM, 'target': '_blank', 'rel': 'noreferrer' }, 't.me/routekernel1'),
			E('br'),
			E('span', {}, _('Tunnel engine: psiphon-tunnel-core by Psiphon Labs. Core build: ')),
			E('code', {}, st.core_rev || _('unknown'))
		]);

		return m.render().then(function(mapNode) {
			window.setTimeout(function() {
				renderState(st);
				renderUsage(data[2]);
				renderPasswall(data[3]);
				renderRules(data[4]);
			}, 0);
			return E([], [ statusCard, troubleSlot, trafficCard, pwCard, rulesCard,
			               howToBox(socksPort, httpPort, listenIface), mapNode, about ]);
		});
	}
});
