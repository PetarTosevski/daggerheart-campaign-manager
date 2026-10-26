import sys
sys.path.insert(0,'/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/gen')
import gen_frames as G
G.FR['custom']=('Custom','f3205851cb5f0694dec14556bfd1988e','Custom','center 40%')
BL={'custom':('f3205851cb5f0694dec14556bfd1988e','center 40%'),'witherwild':('d69136bf0c8eddbad10c2eb636b1b5ca','center'),**{k:(v[1],v[3]) for k,v in G.FR.items() if k!='custom'}}
bgcss=''.join('.bgk-%s{background-image:url(/_blob/%s);background-position:%s}\n'%(k,b,p) for k,(b,p) in BL.items())
LOAD="let CU = {}; try { CU = JSON.parse(window.localStorage.getItem('dh.custom') || '{}') || {}; } catch (e) {}\n    const campaignName = (CU.name || '').trim() || 'Your Campaign'; const bgCls = 'bgk-' + (CU.art || 'custom');\n"
d={'name':'Your Campaign','pages':{},'overviewNote':'','overview':[''],'incidentNote':'','incident':[''],'keyFigures':[],'start':'','mechanicsNote':'','mechanicsSub':'','mechanics':[]}
def R(s,a,b):
    assert s.count(a)==1,(s.count(a),a[:100]); return s.replace(a,b)
# ---------- tome
t=G.build_tome('custom',d)
t=R(t,'</style>',bgcss+'.ct-ta{width:100%;box-sizing:border-box;min-height:420px;padding:16px 18px;border-radius:8px;border:1px solid #cdb88f;background:#f6edd8;color:#2a1f14;font-family:\'EB Garamond\',serif;font-size:19px;line-height:1.6;resize:vertical}\n.ct-ta:focus{outline:2px solid #8e2b2b;outline-offset:1px}\n</style>')
t=t.replace('class="ww-bg ww-dim"','class="ww-bg {{ bgCls }} ww-dim"').replace('<div class="ww-bg" aria-hidden="true" style="margin-top: auto;','<div class="ww-bg {{ bgCls }}" aria-hidden="true" style="margin-top: auto;')
t=R(t,'Campaign Frame · Custom','Custom Campaign Frame')
t=R(t,'>Your Campaign</h2>','>{{ campaignName }}</h2>')
t=R(t,'<title>Your Campaign Tome · Open Book</title>','<title>Custom Campaign Tome</title>')
a=t.index('<div style="flex: 1; min-height: 0; overflow-y: auto; padding-right: 14px;'); a=t.index('\n',a)+1
b=t.index('<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid #cdb88f; padding-top: 14px">')
b=t.rindex('</div>',a,b)
body='''<div role="note" style="display: flex; gap: 14px; padding: 14px 16px; border-radius: 8px; background: #2f4a3a; color: #eef3ea; font-size: 17px; line-height: 1.5"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; margin-top: 2px"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"></path></svg><span>{{ cur.must }}</span></div>
<sc-if value="{{ showSetup }}" hint-placeholder-val="{{ false }}">
<div style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; background: #e3d2ad; border: 1px solid #cdb88f; border-radius: 8px; font-size: 17px; line-height: 1.5">
<div style="font-family: 'Cinzel', serif; font-size: 12px; letter-spacing: 0.22em; color: #7a5b2e">FROM YOUR FRAME SETUP</div>
<sc-for list="{{ setup }}" as="x" hint-placeholder-count="3"><div><strong style="font-family: 'Cinzel', serif; font-size: 14px">{{ x.k }}:</strong> {{ x.v }}</div></sc-for>
</div>
</sc-if>
<sc-if value="{{ isOverview }}" hint-placeholder-val="{{ true }}"><label for="ct-overview" style="font-family: 'Cinzel', serif; font-size: 13px; letter-spacing: 0.2em; color: #7a5b2e">YOUR OVERVIEW</label><textarea id="ct-overview" class="ct-ta" data-k="overview" defaultValue="{{ tx.overview }}" onChange="{{ setText }}" placeholder="{{ cur.ph }}"></textarea></sc-if>
<sc-if value="{{ isIncident }}" hint-placeholder-val="{{ false }}"><label for="ct-incident" style="font-family: 'Cinzel', serif; font-size: 13px; letter-spacing: 0.2em; color: #7a5b2e">YOUR INCITING INCIDENT</label><textarea id="ct-incident" class="ct-ta" data-k="incident" defaultValue="{{ tx.incident }}" onChange="{{ setText }}" placeholder="{{ cur.ph }}"></textarea></sc-if>
<sc-if value="{{ isMechanics }}" hint-placeholder-val="{{ false }}"><label for="ct-mechanics" style="font-family: 'Cinzel', serif; font-size: 13px; letter-spacing: 0.2em; color: #7a5b2e">YOUR CUSTOM MECHANICS</label><textarea id="ct-mechanics" class="ct-ta" data-k="mechanics" defaultValue="{{ tx.mechanics }}" onChange="{{ setText }}" placeholder="{{ cur.ph }}"></textarea></sc-if>
<div style="font-size: 14px; color: #6a5236">{{ savedLine }}</div>
'''
t=t[:a]+body+t[b:]
a=t.index('    const chapters = ['); b=t.index('    const c = chapters[idx];')
CH=[{'roman':'I','title':'Overview','note':'Share your overview with your players before they build characters: the world, its history and what makes it different.',
     'must':'This is your own campaign, so there is no book text here. You need to write your own lore and setting text for this chapter.',
     'paras':[''],'ph':'Write your setting here: the world, its history, its peoples, and the pitch you read to your players…'},
    {'roman':'II','title':'The Inciting Incident','note':'The inciting incident is the event that pulls the party into the story in your first session.',
     'must':'Write your own inciting incident: the event that throws the party together, where the first session starts, and the key figures involved.',
     'paras':[''],'ph':'What happens at the start of the first session? Where are the characters, who do they meet, and what goes wrong?'},
    {'roman':'III','title':'Campaign Mechanics','note':'Campaign mechanics are the special rules that apply only to this campaign. They are optional, but they make a frame feel unique.',
     'must':'No mechanics come with a custom campaign. You need to write your own custom mechanics: special resources, countdowns, environment rules or changes to the core rules.',
     'paras':[''],'ph':'e.g. 1. Corruption: when a PC rolls with Fear in a cursed place, they mark a Corruption token…'}]
t=t[:a]+'    const chapters = '+G.js(CH)+';\n    const rules = [];\n    const FIG = [];\n    '+LOAD+"    let tx = {}; try { tx = JSON.parse(window.localStorage.getItem('dh.custom.tome') || '{}') || {}; } catch (e) {}\n"+t[b:]
t=R(t,"      open, closed: !open, cur, tabs, rules,","      campaignName, bgCls, tx, savedLine: st.saved ? 'Saved to this browser.' : 'Your text saves automatically as you type.',\n      setup: [['Pitch', CU.pitch], ['Themes', CU.themes], ['Touchstones', CU.touch], ['Tone', (CU.tones || []).join(', ')]].filter((x) => x[1] && String(x[1]).trim()).map(([k, v]) => ({ k, v })),\n      showSetup: idx === 0 && !!(CU.pitch || CU.themes || CU.touch || (CU.tones || []).length),\n      setText: (e) => { const k = e.target.getAttribute('data-k'); if (!k) return; let cur0 = {}; try { cur0 = JSON.parse(window.localStorage.getItem('dh.custom.tome') || '{}') || {}; } catch (er) {} cur0[k] = e.target.value; try { window.localStorage.setItem('dh.custom.tome', JSON.stringify(cur0)); } catch (er) {} if (!this.state || !this.state.saved) this.setState({ saved: true }); },\n      open, closed: !open, cur, tabs, rules,")
t=R(t,"isOverview: idx === 0 && false,","isOverview: idx === 0,")
t=R(t,'<div style="padding: 14px 16px; border: 1px solid #cdb88f; border-radius: 6px; background: #e8d9b8; font-size: 16px; line-height: 1.5; font-style: italic; color: #4a3a26"','<div style="padding: 14px 16px; border: 1px solid #cdb88f; border-radius: 6px; background: #e8d9b8; font-size: 16px; line-height: 1.5; font-style: italic; color: #4a3a26; height: 150px; flex: none; box-sizing: border-box; overflow: hidden"')
open(G.PROJ+'TomeCustom.dc.html','w').write(t)
# ---------- hub
h=G.build_hub('custom',d)
h=R(h,'</style>',bgcss+'</style>')
h=R(h,'<div class="ww-bg" aria-hidden="true"','<div class="ww-bg {{ bgCls }}" aria-hidden="true"')
h=R(h,'Active Campaign · Your Campaign','Active Campaign · Custom Frame')
h=R(h,'font-weight: 900">[Campaign name]</h1>','font-weight: 900">{{ campaignName }}</h1>')
h=R(h,'<title>Campaign · Your Campaign</title>','<title>Campaign · Custom</title>')
h=R(h,'<h2 id="npc-h" style="margin: 0; font-family: \'Cinzel\', serif; font-size: 22px; font-weight: 700">Key Figures</h2>\n<div style="display: flex; flex-direction: column; gap: 2px">\n</div>',
      '<h2 id="npc-h" style="margin: 0; font-family: \'Cinzel\', serif; font-size: 22px; font-weight: 700">Key Figures</h2>\n<p style="margin: 0; font-size: 14px; line-height: 1.5; color: #9fb2b6">Your campaign has no preset figures. Write your own in the tome\'s Inciting Incident.</p>')
import re as _re, json as _json
CBL={'custom':'f3205851cb5f0694dec14556bfd1988e',**{k:v[0] for k,v in BL.items()}}
h=_re.sub(r'    const ACTIVE = \{[^\n]*\n', lambda m: '    '+LOAD+"    const ACTIVE = { key: 'custom', hub: 'HubCustom.dc.html', name: campaignName, blob: "+_json.dumps(CBL)+"[(CU.art || 'custom')] || 'f3205851cb5f0694dec14556bfd1988e' };\n", h, count=1)
h=R(h,'    return {\n      sessInfo,','    return {\n      campaignName, bgCls,\n      sessInfo,')
open(G.PROJ+'HubCustom.dc.html','w').write(h)
print('ok')
