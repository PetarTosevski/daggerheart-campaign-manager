import re
S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
P=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/FrameSelect.dc.html'
s=open(P).read()
def rep(a,b):
    global s; assert s.count(a)==1,(s.count(a),a[:90]); s=s.replace(a,b)
rep('<button type="button" style="min-height: 50px; padding: 0 20px; border-radius: 10px; border: 1px solid #3a3449; background: transparent; color: #ece6d6; font-size: 15px; cursor: pointer; font-family: inherit">Customize this frame</button>','')
for k in ['name','pitch','themes','touch','party','tier']:
    rep('id="cu-'+k+'"','id="cu-'+k+'" data-k="'+k+'" defaultValue="{{ cu.'+k+' }}" onChange="{{ setCu }}"')
rep('<option selected="">4</option>','<option>4</option>')
rep('<option selected="">Tier 1 · Lvl 1</option>','<option>Tier 1 · Lvl 1</option>')
bg='''<div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 10px">
<span style="font-size: 14px; color: #b9b2c7">Dashboard background</span>
<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px">
<sc-for list="{{ bgList }}" as="b" hint-placeholder-count="10">
<button type="button" onClick="{{ b.pick }}" aria-pressed="{{ b.pressed }}" aria-label="{{ b.label }}" title="{{ b.label }}" class="{{ b.cls }}" style="{{ b.style }}"><span class="cu-bg-lbl">{{ b.label }}</span></button>
</sc-for>
</div>
</div>
<div style="grid-column: 1 / -1; padding: 14px 16px; border-radius: 10px; border: 1px dashed #4a4360; color: #b9b2c7; font-size: 14px; line-height: 1.5">A custom campaign starts with a blank tome. You write the Overview, Inciting Incident and Campaign Mechanics yourself from the campaign dashboard.</div>
</section>
</sc-if>
</main>'''
rep('</section>\n</sc-if>\n</main>',bg)
rep('</style>','.cu-bg-lbl{position:absolute;left:0;right:0;bottom:0;padding:4px 6px;font-size:12px;background:linear-gradient(transparent,rgba(0,0,0,.8));color:#ece6d6;text-align:left}\n</style>')
rep("this.state = { kind: 'frame', frame: 0, tones: ['Adventurous', 'Heroic'] };",
"let cu = {}; try { cu = JSON.parse(window.localStorage.getItem('dh.custom') || '{}') || {}; } catch (e) {}\n    this.state = { kind: 'frame', frame: 0, cu: { party: '4', tier: 'Tier 1 · Lvl 1', bg: 'witherwild', tones: ['Adventurous', 'Heroic'], ...cu } };")
rep("const { kind, frame, tones } = this.state;","const { kind, frame, cu } = this.state; const tones = cu.tones || [];\n    const saveCu = (patch) => { const n = { ...this.state.cu, ...patch }; try { window.localStorage.setItem('dh.custom', JSON.stringify(n)); } catch (e) {} this.setState({ cu: n }); };")
rep("toggle: () => this.setState({ tones: on ? tones.filter((t) => t !== label) : tones.concat(label) }),","toggle: () => saveCu({ tones: on ? tones.filter((t) => t !== label) : tones.concat(label) }),")
rep("    const isFrame = kind === 'frame';\n","""    const isFrame = kind === 'frame';
    const BGS = [['witherwild','The Witherwild','art-witherwild'],['fivebanners','Five Banners','art-fivebanners'],['beastfeast','Beast Feast','art-beastfeast'],['umbra','Age of Umbra','art-umbra'],['motherboard','Motherboard','art-motherboard'],['colossus','Colossus','art-colossus'],['castlehigh','Castle High','art-castle'],['weredragon','Weredragon','art-weredragon'],['andaluria','Andaluria','art-andaluria'],['horizon','Horizon','art-horizon']];
    const bgList = BGS.map(([k, label, cls]) => { const on = (cu.bg || 'witherwild') === k; return { label, cls, pressed: on ? 'true' : 'false', pick: () => saveCu({ bg: k }), style: 'position: relative; overflow: hidden; height: 76px; border-radius: 10px; cursor: pointer; padding: 0; background-color: #1d1a27; border: 2px solid ' + (on ? accent : '#2a2536') + '; opacity: ' + (on ? '1' : '0.7') + ';' }; });
    const cuName = (cu.name || '').trim();
""")
rep("accent, frames, sel, tones: toneList,","accent, frames, sel, tones: toneList, cu, bgList,\n      setCu: (e) => { const k = e.target.getAttribute('data-k'); if (k) saveCu({ [k]: e.target.value }); },")
rep("summary: isFrame ? 'Frame: ' + sel.name : 'Custom frame · ' + tones.length + ' tones',","summary: isFrame ? 'Frame: ' + sel.name : (cuName ? 'Custom: ' + cuName + ' · ' + tones.length + ' tones' : 'Name your campaign to start'),")
rep("const hub = isFrame && sel && sel.page ? (sel.page === 'Witherwild.dc.html' ? 'CampaignHub.dc.html' : 'Hub' + sel.page) : '';","const hub = isFrame ? (sel && sel.page ? (sel.page === 'Witherwild.dc.html' ? 'CampaignHub.dc.html' : 'Hub' + sel.page) : '') : (cuName ? 'HubCustom.dc.html' : '');")
open(P,'w').write(s); print('ok')
