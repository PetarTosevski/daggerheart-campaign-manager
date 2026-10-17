import re
S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
P=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/'
w=open(P+'World.dc.html').read(); MAPS=re.search(r"const MAPS = \{[^;]*\};",w).group(0)
f=P+'Codex.dc.html'; s=open(f).read()
def R(a,b,n=1):
    global s; assert s.count(a)==n,(s.count(a),a[:90]); s=s.replace(a,b)
R("const uid = (p) =>",MAPS+"\nconst PIN_TYPES = [['landmark', 'Landmark'], ['city', 'City'], ['village', 'Village'], ['temple', 'Temple'], ['ruins', 'Ruins'], ['cave', 'Cave'], ['dungeon', 'Dungeon'], ['camp', 'Camp'], ['treasure', 'Treasure'], ['quest', 'Quest']];\nconst uid = (p) =>")
# GM pin controls (first occurrence = GM block)
old='<sc-if value="{{ d.hasPin }}" hint-placeholder-val="{{ false }}"><a href="World.dc.html" onClick="{{ d.showOnMap }}" class="cx-ghost">📍 Show on map</a></sc-if>'
i=s.index(old)
new=('<sc-if value="{{ d.isLoc }}" hint-placeholder-val="{{ false }}"><button type="button" class="cx-ghost" onClick="{{ d.openPick }}">{{ d.pinBtn }}</button></sc-if>'
     '<sc-if value="{{ d.hasPin }}" hint-placeholder-val="{{ false }}"><a href="World.dc.html" onClick="{{ d.showOnMap }}" class="cx-ghost">🗺 Show on map</a><button type="button" class="cx-ghost" onClick="{{ d.unpin }}" title="Keep the map pin but stop linking it to this location" style="color: #9fb2b6">Unlink</button></sc-if>')
s=s[:i]+new+s[i+len(old):]
# detail values
R("        isChar: !isLocs, isLoc: isLocs,",
"""        isChar: !isLocs, isLoc: isLocs,
        pinBtn: e.pin != null && pinById[e.pin] ? '📍 Move pin' : '📍 Place on map',
        openPick: () => this.setState({ pick: { id, type: (pinById[e.pin] && pinById[e.pin].type) || 'landmark' } }),
        unpin: () => upd(id, { pin: null }),""")
R("hasPin: e.pin != null,","hasPin: e.pin != null && !!pinById[e.pin],")
# rename linked map token when the name changes
R("        setF: (ev) => { const f = ev.target.getAttribute('data-f'); if (f) upd(id, { [f]: ev.target.value }); },",
  "        setF: (ev) => { const f = ev.target.getAttribute('data-f'); if (!f) return; upd(id, { [f]: ev.target.value }); if (f === 'name' && e.pin != null) { const md = ls('dh.' + act.key + '.map', null); if (md && md.tokens) { try { window.localStorage.setItem('dh.' + act.key + '.map', JSON.stringify({ ...md, tokens: md.tokens.map((t) => (t.id === e.pin ? { ...t, name: ev.target.value } : t)) })); } catch (er) {} } } },")
# picker values
R("    // lightbox","""    // ---- map picker: place / move / link a pin for a location
    const pickUi = (() => {
      const pk = st.pick; if (!pk) return { on: false };
      const e = (codex.locs || []).find((x) => x.id === pk.id); if (!e) return { on: false };
      const MC = MAPS[act.key] || null; const MW = MC ? MC[1] : 1600, MH = MC ? MC[2] : 1200;
      const md = ls('dh.' + act.key + '.map', null) || { tokens: [], party: { x: 44, y: 52, trail: [] }, nextId: 1 };
      const toks = md.tokens || [];
      const writeMap = (m) => { try { window.localStorage.setItem('dh.' + act.key + '.map', JSON.stringify(m)); } catch (er) {} };
      const linkTo = (tid) => { const cx = this.state.codex || codex; persist({ ...cx, locs: (cx.locs || []).map((x) => (x.id === e.id ? { ...x, pin: tid } : x)) }, { pick: null }); };
      return { on: true, title: 'Place “' + (e.name || 'this location') + '” on the map',
        types: PIN_TYPES.map(([v, label]) => ({ v, label })), type: pk.type || 'landmark', setType: (ev) => this.setState({ pick: { ...pk, type: ev.target.value } }),
        mapStyle: 'position: relative; width: 100%; max-height: calc(100vh - 260px); aspect-ratio: ' + MW + ' / ' + MH + '; margin: 0 auto; border-radius: 10px; overflow: hidden; cursor: crosshair; background-size: 100% 100%; background-repeat: no-repeat;' + (MC ? ' background-image: url(/_blob/' + MC[0] + ');' : ' background-color: #e6d8b8;'),
        pins: toks.map((t) => { const mine = t.id === e.pin; const used = (codex.locs || []).some((x) => x.pin === t.id && x.id !== e.id);
          return { title: (t.name || 'Pin') + (mine ? ' (this location)' : used ? ' (linked to another location)' : ' — click to link'), label: t.name || '',
            style: 'position: absolute; left: ' + t.x + '%; top: ' + t.y + '%; transform: translate(-50%, -50%); width: ' + (mine ? 22 : 16) + 'px; height: ' + (mine ? 22 : 16) + 'px; border-radius: 50%; padding: 0; cursor: pointer; border: 2px solid #fff3d6; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6); background: ' + (mine ? accent : used ? '#6a5a8a' : '#2a6a6a') + ';',
            lblStyle: 'position: absolute; left: ' + t.x + '%; top: calc(' + t.y + '% + 12px); transform: translateX(-50%); font-size: 11px; font-weight: 600; color: #2a1f14; background: rgba(239, 227, 200, 0.85); padding: 0 4px; border-radius: 4px; pointer-events: none; white-space: nowrap;',
            pick: (ev) => { ev.stopPropagation(); if (mine) { this.setState({ pick: null }); return; } linkTo(t.id); } }; }),
        place: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); const x = +(Math.max(0, Math.min(100, (ev.clientX - r.left) / r.width * 100))).toFixed(2), y = +(Math.max(0, Math.min(100, (ev.clientY - r.top) / r.height * 100))).toFixed(2);
          const m = ls('dh.' + act.key + '.map', null) || { tokens: [], party: { x: 44, y: 52, trail: [] }, nextId: 1 }; const ts = m.tokens || [];
          if (e.pin != null && ts.some((t) => t.id === e.pin)) { writeMap({ ...m, tokens: ts.map((t) => (t.id === e.pin ? { ...t, x, y, type: pk.type || t.type } : t)) }); linkTo(e.pin); return; }
          const nid = m.nextId || (ts.reduce((a, t) => Math.max(a, t.id || 0), 0) + 1);
          writeMap({ ...m, nextId: nid + 1, tokens: ts.concat([{ id: nid, type: pk.type || 'landmark', x, y, name: e.name || 'New location', notes: '', location: true }]) }); linkTo(nid); },
        cancel: () => this.setState({ pick: null }), stop: (ev) => ev.stopPropagation() };
    })();
    // lightbox""")
R("      accent, navItems, kindTabs, listItems, details, lb,","      accent, navItems, kindTabs, listItems, details, lb, pick: pickUi,")
MODAL='''<sc-if value="{{ pick.on }}" hint-placeholder-val="{{ false }}">
<div role="dialog" aria-modal="true" aria-label="{{ pick.title }}" style="position: fixed; inset: 0; z-index: 100; background: rgba(3, 6, 7, 0.9); display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box">
<div style="width: 100%; max-width: 1100px; max-height: 100%; overflow: auto; background: #141e22; border: 1px solid #e3b45a; border-radius: 14px; padding: 18px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px"><h2 class="cx-h" style="flex: 1">{{ pick.title }}</h2>
<label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #9fb2b6">Pin type<select class="cx-in" value="{{ pick.type }}" onChange="{{ pick.setType }}" style="width: auto; min-height: 38px"><sc-for list="{{ pick.types }}" as="o" hint-placeholder-count="5"><option value="{{ o.v }}">{{ o.label }}</option></sc-for></select></label>
<button type="button" class="cx-ghost" onClick="{{ pick.cancel }}">Cancel</button></div>
<p class="cx-muted" style="margin: 0">Click anywhere on the map to drop the pin there, or click an existing pin to link this location to it. The pin also appears on the World map.</p>
<div onClick="{{ pick.place }}" style="{{ pick.mapStyle }}">
<sc-for list="{{ pick.pins }}" as="pp" hint-placeholder-count="3"><button type="button" onClick="{{ pp.pick }}" title="{{ pp.title }}" aria-label="{{ pp.title }}" style="{{ pp.style }}"></button><span aria-hidden="true" style="{{ pp.lblStyle }}">{{ pp.label }}</span></sc-for>
</div>
</div>
</div>
</sc-if>
'''
R('<sc-if value="{{ lb.on }}" hint-placeholder-val="{{ false }}">',MODAL+'<sc-if value="{{ lb.on }}" hint-placeholder-val="{{ false }}">')
open(f,'w').write(s); print('ok')
