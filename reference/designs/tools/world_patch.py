S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/World.dc.html'; s=open(f).read()
def R(a,b,n=1):
    global s; assert s.count(a)==n,(s.count(a),a[:90]); s=s.replace(a,b)
R('<div class="ww-bg" aria-hidden="true" style="position: absolute; inset: 0"></div>','<div class="ww-bg" aria-hidden="true" style="{{ headerBg }}"></div>')
R('color: #c8d3d0">The Witherwild · World</div>','color: #c8d3d0">{{ worldTitle }}</div>')
R('<section aria-label="Map of the Witherwild"','<section aria-label="{{ mapAria }}"')
R('<div data-map="1" class="wmap"','<sc-if value="{{ noMap }}" hint-placeholder-val="{{ false }}"><div role="note" style="padding: 10px 14px; border-radius: 10px; background: #2a2416; border: 1px solid #5a4a2a; color: #f0dfb8; font-size: 14px; line-height: 1.5">A custom campaign has no published map, so this is a blank parchment. Pins, the party marker, terrain painting and distances all still work.</div></sc-if>\n<div data-map="1" class="wmap"')
CFG='''    const ACT = (() => { try { return JSON.parse(window.localStorage.getItem('dh.active') || 'null') || {}; } catch (e) { return {}; } })();
    const MAPS = { witherwild: ['30e1f9055a3fb07f7b9757744ff252b7', 1553, 1193, 400], fivebanners: ['0324f5cce8dd7ddafaab98afb1e52c35', 3169, 2418, 900], beastfeast: ['2b3cd581f42bb8f5d57baaad854f8fce', 2418, 3169, 300], umbra: ['37022de6c1f227e428f30404da54273d', 3169, 2418, 600], motherboard: ['cededc1a7d491b939156e45165bff355', 3169, 2418, 400], colossus: ['9b5f07cc6f1d2e9889c4121f2f3f03a5', 3169, 2418, 500], castlehigh: ['0b1a7dc08df5c136255e0f50a5101e7f', 3157, 2404, 12], weredragon: ['88ea2d92a5d4d6e732ffe14114d5ab2d', 2404, 3157, 800], andaluria: ['05b31ac534fcba6a871f8dc1b9128e34', 3157, 2404, 400], horizon: ['b39beec08ef477314e2eb8bc801bcb56', 3400, 2228, 2400] };
    const CKEY = ACT.key || 'witherwild';
    const MC = MAPS[CKEY] || null;
    const MW = MC ? MC[1] : 1600, MH = MC ? MC[2] : 1200;
'''
R("    const KEY = 'dh.witherwild.map';", CFG+"    const KEY = 'dh.' + CKEY + '.map';")
R("const W = data.scaleKm || 400; const H = W * 1193 / 1553;","const W = data.scaleKm || (MC ? MC[3] : 400); const H = W * MH / MW;")
R("aspect-ratio: 1553 / 1193;","aspect-ratio: ' + MW + ' / ' + MH + ';")
R("const terrain = (st.paintGrid || data.terrain || TDEF);","const terrain = (st.paintGrid || data.terrain || (CKEY === 'witherwild' ? TDEF : 'w'.repeat(64 * 49)));")
R("window.localStorage.getItem('dh.witherwild.mapFocus'); if (f) { window.localStorage.removeItem('dh.witherwild.mapFocus');","window.localStorage.getItem('dh.' + CKEY + '.mapFocus'); if (f) { window.localStorage.removeItem('dh.' + CKEY + '.mapFocus');")
R("    return { dashHref, navAccent,","    return { dashHref, navAccent,\n      noMap: !MC, worldTitle: (ACT.name || 'The Witherwild') + ' · World', mapAria: 'Map of ' + (ACT.name || 'the Witherwild'),\n      headerBg: 'position: absolute; inset: 0;' + (ACT.blob ? ' background-image: url(/_blob/' + ACT.blob + ');' : ''),")
open(f,'w').write(s); print('ok')
