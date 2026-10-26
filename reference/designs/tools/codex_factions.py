S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/Codex.dc.html'; s=open(f).read()
def R(a,b):
    global s; assert s.count(a)==1,(s.count(a),a[:90]); s=s.replace(a,b)
# ---- module-level config
R("const uid = (p) =>",r"""// ---- allegiances (characters) and regions (locations) per campaign
const FACTIONS = { witherwild: ['Haven', 'Fanewick', 'Neutral'] };
const REGIONS = { witherwild: ['Haven', 'Colonies', 'Fanewick'] };
const SEED_AL = { 'Kreil Dirn': 'Haven', 'The Fanewraith': 'Fanewick', 'Archmage Phylax': 'Haven', 'Nikta, the Great Owl': 'Neutral' };
// Witherwild map (percent coords of the World map): Haven city walls, and the dotted border of the colonies
const POLY_HAVEN = [[47, 38], [50, 33], [53.5, 23], [57, 25], [60, 32], [63.5, 38], [62.5, 45.5], [56, 46.5], [48.5, 45.5]];
const POLY_COLONIES = [[39.5, 0], [39.5, 34], [37, 37.5], [35.2, 41.5], [35.3, 46], [36.8, 50], [39.5, 52.2], [43, 53.6], [50, 55.4], [60, 55.6], [70, 55.2], [75, 53.4], [78.5, 50.5], [79.6, 46], [80.5, 44.6], [84.5, 45.3], [88, 47], [91, 48.6], [100, 48.6], [100, 0]];
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const regionAt = (key, x, y) => key !== 'witherwild' ? '' : inPoly(x, y, POLY_HAVEN) ? 'Haven' : inPoly(x, y, POLY_COLONIES) ? 'Colonies' : 'Fanewick';
const uid = (p) =>""")
# seed allegiance + migration
R("codex = { chars: (SEED[act.key] || []).map(([name, role]) => ({ id: uid('c'), name, role, known: false, pdesc: '', gmn: '', imgs: [], cover: null })), locs: [] };",
  "codex = { chars: (SEED[act.key] || []).map(([name, role]) => ({ id: uid('c'), name, role, known: false, pdesc: '', gmn: '', imgs: [], cover: null, al: SEED_AL[name] || '', alShown: 'unknown' })), locs: [] };")
R("    const persist = (cx, extra) =>","""    if (codex.chars && codex.chars.some((e) => e.al === undefined)) { codex = { ...codex, chars: codex.chars.map((e) => (e.al === undefined ? { ...e, al: SEED_AL[e.name] || '', alShown: e.alShown || 'unknown' } : e)) }; try { window.localStorage.setItem(CK, JSON.stringify(codex)); } catch (e) {} }
    const persist = (cx, extra) =>""")
# grouping logic: replace shown filter
R("    const shown = list.filter((e) => (gm || e.known) && (!q || (e.name + ' ' + (e.role || '')).toLowerCase().includes(q)));",
r"""    const FAC = FACTIONS[act.key] || ['Allies', 'Enemies', 'Neutral'];
    const REG = REGIONS[act.key] || [];
    const mapData = ls('dh.' + act.key + '.map', null); const pinById = {}; ((mapData && mapData.tokens) || []).forEach((t) => { pinById[t.id] = t; });
    const regionOf = (e) => { const t = e.pin != null ? pinById[e.pin] : null; if (t && REG.length) { const r = regionAt(act.key, t.x, t.y); if (r) return { r, auto: true }; } return { r: e.region || '', auto: false }; };
    const groupOf = (e) => isLocs ? regionOf(e).r : gm ? (e.al || '') : (e.alShown && e.alShown !== 'unknown' ? e.alShown : '');
    const GROUPS = isLocs ? REG : FAC;
    const grp = st.grp && st.grp[kind] != null ? st.grp[kind] : 'all';
    const base = list.filter((e) => (gm || e.known) && (!q || (e.name + ' ' + (e.role || '')).toLowerCase().includes(q)));
    const shown = base.filter((e) => grp === 'all' || (grp === '' ? !groupOf(e) : groupOf(e) === grp));
    const unknownLabel = isLocs ? 'Unsorted' : gm ? 'Unassigned' : 'Allegiance unknown';
    const groupTabs = (!isLocs || REG.length) ? [['all', 'All']].concat(GROUPS.map((g) => [g, g])).concat([['', unknownLabel]]).map(([k2, label]) => { const n = k2 === 'all' ? base.length : base.filter((e) => (k2 === '' ? !groupOf(e) : groupOf(e) === k2)).length; const on = grp === k2;
      return { label: label + ' · ' + n, hide: k2 === '' && !n && !on, pressed: on ? 'true' : 'false', pick: () => this.setState({ grp: { ...(st.grp || {}), [kind]: k2 }, sel: null }),
        style: 'min-height: 32px; padding: 0 12px; border-radius: 999px; cursor: pointer; font-family: inherit; font-size: 13px; color: ' + (on ? '#1a1408' : '#e6ecea') + '; background: ' + (on ? accent : 'transparent') + '; border: 1px solid ' + (on ? accent : '#33444a') + ';' + (k2 === '' && !n && !on ? ' display: none;' : '') }; }) : [];""")
# list item badge
R("        knownText: e.known ? 'Known' : 'Secret',","        grpText: groupOf(e) || (isLocs ? '' : (gm ? 'Unassigned' : 'Allegiance unknown')), hasGrp: !!(groupOf(e) || !isLocs),\n        grpStyle: 'background: ' + ({ Haven: '#1d2a3f', Fanewick: '#1f3322', Neutral: '#2b2b2b', Colonies: '#3a2d1a' }[groupOf(e)] || '#2a1f24') + '; color: ' + ({ Haven: '#a9c6ff', Fanewick: '#a8e0a0', Neutral: '#d0d0d0', Colonies: '#f0cf8a' }[groupOf(e)] || '#e0a3b0') + ';',\n        knownText: e.known ? 'Known' : 'Secret',")
R('<span style="display: flex; gap: 6px; flex-wrap: wrap"><sc-if value="{{ it.showBadges }}"','<span style="display: flex; gap: 6px; flex-wrap: wrap"><sc-if value="{{ it.hasGrp }}" hint-placeholder-val="{{ true }}"><span class="cx-badge" style="{{ it.grpStyle }}">{{ it.grpText }}</span></sc-if><sc-if value="{{ it.showBadges }}"')
# group tabs markup after search input
R('<input class="cx-in" type="search" placeholder="{{ searchPh }}"','<sc-if value="{{ hasGroups }}" hint-placeholder-val="{{ true }}"><div role="tablist" aria-label="{{ groupAria }}" style="display: flex; flex-wrap: wrap; gap: 6px"><sc-for list="{{ groupTabs }}" as="gt" hint-placeholder-count="4"><button type="button" role="tab" aria-selected="{{ gt.pressed }}" onClick="{{ gt.pick }}" style="{{ gt.style }}">{{ gt.label }}</button></sc-for></div></sc-if>\n<input class="cx-in" type="search" placeholder="{{ searchPh }}"')
R("      accent, navItems, kindTabs, listItems, details, lb,","      accent, navItems, kindTabs, listItems, details, lb, groupTabs, hasGroups: groupTabs.length > 0, groupAria: isLocs ? 'Regions' : 'Allegiances',")
# detail: allegiance / region controls
R("        on, gm, pl: player, name: e.name || '',",
r"""        isChar: !isLocs, isLoc: isLocs,
        alOpts: [{ v: '', label: 'Unassigned' }].concat(FAC.map((g) => ({ v: g, label: g }))), al: e.al || '',
        shownOpts: [{ v: 'unknown', label: 'Allegiance unknown' }].concat(FAC.map((g) => ({ v: g, label: g }))), alShown: e.alShown || 'unknown',
        setAl: (ev) => upd(id, { al: ev.target.value }), setShown: (ev) => upd(id, { alShown: ev.target.value }),
        revealAl: () => upd(id, (x) => ({ alShown: x.al || 'unknown' })), canReveal: !!e.al && e.alShown !== e.al,
        alMismatch: !!e.al && e.alShown && e.alShown !== 'unknown' && e.alShown !== e.al, alNote: !e.al ? '' : e.alShown === e.al ? 'Players know the truth.' : (e.alShown || 'unknown') === 'unknown' ? 'Players don’t know where their loyalty lies.' : 'Players believe a cover story.',
        plAl: (e.alShown && e.alShown !== 'unknown') ? e.alShown : 'Allegiance unknown',
        hasRegions: REG.length > 0, regAuto: regionOf(e).auto, regName: regionOf(e).r || 'Unsorted', regOpts: [{ v: '', label: 'Unsorted' }].concat(REG.map((g) => ({ v: g, label: g }))), region: e.region || '',
        setRegion: (ev) => upd(id, { region: ev.target.value }), regionNote: regionOf(e).auto ? 'Set automatically from where its pin sits on the World map.' : 'Pick a region, or link this place to a map pin to set it automatically.',
        on, gm, pl: player, name: e.name || '',""")
GM_CTRL='''<sc-if value="{{ d.isChar }}" hint-placeholder-val="{{ true }}"><div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; padding: 12px; border-radius: 10px; background: #0f181b; border: 1px solid #253338">
<label style="display: flex; flex-direction: column; gap: 6px"><span class="cx-lbl">True allegiance</span><select class="cx-in" value="{{ d.al }}" onChange="{{ d.setAl }}" aria-label="True allegiance"><sc-for list="{{ d.alOpts }}" as="o" hint-placeholder-count="4"><option value="{{ o.v }}">{{ o.label }}</option></sc-for></select></label>
<label style="display: flex; flex-direction: column; gap: 6px"><span class="cx-lbl">Players see</span><select class="cx-in" value="{{ d.alShown }}" onChange="{{ d.setShown }}" aria-label="Allegiance the players see"><sc-for list="{{ d.shownOpts }}" as="o" hint-placeholder-count="4"><option value="{{ o.v }}">{{ o.label }}</option></sc-for></select></label>
<div style="grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap"><span class="cx-muted" style="font-size: 13px; flex: 1">{{ d.alNote }}</span><sc-if value="{{ d.canReveal }}" hint-placeholder-val="{{ false }}"><button type="button" class="cx-ghost" onClick="{{ d.revealAl }}" style="min-height: 34px; font-size: 13px">👁 Reveal true allegiance</button></sc-if></div>
</div></sc-if>
<sc-if value="{{ d.isLoc }}" hint-placeholder-val="{{ false }}"><sc-if value="{{ d.hasRegions }}" hint-placeholder-val="{{ false }}"><div style="display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 10px; background: #0f181b; border: 1px solid #253338">
<span class="cx-lbl">Region</span>
<sc-if value="{{ d.regAuto }}" hint-placeholder-val="{{ false }}"><span style="font-family: 'Cinzel', serif; font-size: 18px; font-weight: 700">{{ d.regName }} <span style="font-size: 12px; font-family: inherit; font-weight: 400; color: #9fb2b6">· 📍 from map pin</span></span></sc-if>
<sc-if value="{{ d.regManual }}" hint-placeholder-val="{{ true }}"><select class="cx-in" value="{{ d.region }}" onChange="{{ d.setRegion }}" aria-label="Region"><sc-for list="{{ d.regOpts }}" as="o" hint-placeholder-count="4"><option value="{{ o.v }}">{{ o.label }}</option></sc-for></select></sc-if>
<span class="cx-muted" style="font-size: 13px">{{ d.regionNote }}</span>
</div></sc-if></sc-if>
'''
R('''<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center">
<button type="button" onClick="{{ d.toggleKnown }}"''', GM_CTRL+'''<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center">
<button type="button" onClick="{{ d.toggleKnown }}"''')
R("hasRegions: REG.length > 0, regAuto: regionOf(e).auto,","hasRegions: REG.length > 0, regAuto: regionOf(e).auto, regManual: !regionOf(e).auto,")
# player detail badge
R('<div style="font-size: 16px; color: #c8d3d0">{{ d.role }}</div>','<div style="font-size: 16px; color: #c8d3d0">{{ d.role }}</div>\n<sc-if value="{{ d.isChar }}" hint-placeholder-val="{{ true }}"><span class="cx-badge" style="align-self: flex-start; background: #1b282d; color: #e6ecea; font-size: 12px">⚑ {{ d.plAl }}</span></sc-if><sc-if value="{{ d.isLoc }}" hint-placeholder-val="{{ false }}"><sc-if value="{{ d.hasRegions }}" hint-placeholder-val="{{ false }}"><span class="cx-badge" style="align-self: flex-start; background: #1b282d; color: #e6ecea; font-size: 12px">⌂ {{ d.regName }}</span></sc-if></sc-if>')
open(f,'w').write(s); print('ok')
