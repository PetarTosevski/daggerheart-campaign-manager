import re
S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
P=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/'
def R(s,a,b,n=1):
    assert s.count(a)==n,(s.count(a),a[:90]); return s.replace(a,b)
HUBS=['CampaignHub','HubFiveBanners','HubBeastFeast','HubAgeOfUmbra','HubMotherboard','HubColossus','HubCastleHigh','HubWeredragon','HubAndaluria','HubHorizon','HubCustom']
for h in HUBS:
    f=P+h+'.dc.html'; s=open(f).read()
    key=re.search(r"const CDKEY = 'dh\.([a-z]+)\.countdowns'",s).group(1)
    s=R(s,"const KEY = 'dh.witherwild.party';","const KEY = 'dh."+key+".party';")
    open(f,'w').write(s); print(h,key)
f=P+'Sessions.dc.html'; s=open(f).read()
s=R(s,"const v = ls('dh.witherwild.party', []);","const v = ls('dh.' + act.key + '.party', []);")
open(f,'w').write(s)
f=P+'Party.dc.html'; s=open(f).read()
NAMES="{ witherwild: 'The Witherwild', fivebanners: 'Five Banners Burning', beastfeast: 'Beast Feast', umbra: 'The Age of Umbra', motherboard: 'Motherboard', colossus: 'Colossus of the Drylands', castlehigh: 'Castle High', weredragon: 'Reign of the Weredragon', andaluria: 'Dark Heart of Andaluria', horizon: 'Journey to Horizon', custom: 'Custom campaign' }"
s=R(s,"    const KEY = 'dh.witherwild.party';",
"""    const ACT = (() => { try { return JSON.parse(window.localStorage.getItem('dh.active') || 'null') || {}; } catch (e) { return {}; } })();
    const PKEY = ACT.key || 'witherwild'; const CNAME = ACT.name || 'The Witherwild';
    const KEY = 'dh.' + PKEY + '.party';
    const CNAMES = """+NAMES+""";
    const importSources = (() => { const out = []; try { for (let i = 0; i < window.localStorage.length; i++) { const k = window.localStorage.key(i); const m = /^dh\\.([a-z]+)\\.party$/.exec(k || ''); if (!m || m[1] === PKEY) continue; let v = []; try { v = JSON.parse(window.localStorage.getItem(k) || '[]'); } catch (e) {} if (Array.isArray(v) && v.length) out.push({ key: m[1], list: v }); } } catch (e) {} return out; })();""")
s=R(s,'color: #c8d3d0">[Campaign name] · The Witherwild</div>','color: #c8d3d0">{{ partyCampaign }}</div>')
s=R(s,'No characters yet. Create the first hero of your Witherwild party.</p></sc-if>',
 'No characters yet. Create the first hero of this party.</p></sc-if>\n<sc-if value="{{ hasImports }}" hint-placeholder-val="{{ false }}"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 14px; border-radius: 12px; background: #141e22; border: 1px dashed #3a4d54"><span style="font-size: 14px; color: #c8d3d0; margin-right: 4px">Each campaign has its own party. Copy characters from another campaign:</span><sc-for list="{{ imports }}" as="im" hint-placeholder-count="2"><button type="button" onClick="{{ im.copy }}" style="min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid #3d5e2e; background: #233a2b; color: #e9f2e4; font-size: 14px; cursor: pointer; font-family: inherit">{{ im.label }}</button></sc-for></div></sc-if>')
s=R(s,'<div class="ww-bg" aria-hidden="true" style="position: absolute; inset: 0"></div>','<div class="ww-bg" aria-hidden="true" style="{{ partyBg }}"></div>')
s=R(s,"      accent, roster, empty: chars.length === 0,",
"""      accent, roster, empty: chars.length === 0,
      partyCampaign: CNAME + ' · Party', partyBg: 'position: absolute; inset: 0;' + (ACT.blob ? ' background-image: url(/_blob/' + ACT.blob + ');' : ''),
      hasImports: importSources.length > 0 && !st.creating,
      imports: importSources.map((src) => { const nm = src.key === 'custom' ? 'custom campaign' : (CNAMES[src.key] || src.key); return { label: '+ ' + src.list.length + (src.list.length === 1 ? ' hero' : ' heroes') + ' from ' + nm, copy: () => { const have = new Set(chars.map((c) => JSON.stringify(c.f && c.f.name) + (c.cls))); const add = src.list.filter((c) => !have.has(JSON.stringify(c.f && c.f.name) + (c.cls))).map((c) => JSON.parse(JSON.stringify(c))); save(chars.concat(add), { savedMsg: add.length ? 'Copied ' + add.length + (add.length === 1 ? ' character' : ' characters') + ' from ' + nm + '.' : 'Those characters are already in this party.' }); } }; }),""")
open(f,'w').write(s); print('party ok')
# generator: party key
g=S+'gen/gen_frames.py'; gs=open(g).read()
gs=R(gs,"""    s=rep(s,"'dh.witherwild.sessions'",""","""    s=rep(s,"const KEY = 'dh.witherwild.party';","const KEY = 'dh."+key+".party';")\n    s=rep(s,"'dh.witherwild.sessions'",""")
gs=gs.replace(""".replace("'dh.witherwild.party'",'')""","")
open(g,'w').write(gs)
