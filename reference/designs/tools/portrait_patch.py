import json,re
S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
P=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/'
PT=json.load(open(S+'portraits.json'))
PTJS=json.dumps(PT,separators=(',',':')).replace(']}','] }').replace('}}','} }')
HELP=("const PORTRAITS = "+PTJS+";\n"
"const portraitCss = (f) => {\n"
"  f = f || {};\n"
"  if (f.portrait) return 'background-image: url(' + f.portrait + '); background-position: center 30%;';\n"
"  const slug = (k, n) => k + '-' + String(n || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');\n"
"  const anc = f.mixed && f.mixed.a ? f.mixed.a : f.ancestry;\n"
"  const hit = PORTRAITS[slug('sub', f.subclass)] || PORTRAITS[slug('anc', anc)];\n"
"  return hit ? 'background-image: url(/_blob/' + hit[0] + '); background-position: ' + hit[1] + ';' : '';\n"
"};\n")
def R(s,a,b):
    assert s.count(a)==1,(s.count(a),a[:100]); return s.replace(a,b)
HUBS=['CampaignHub','HubFiveBanners','HubBeastFeast','HubAgeOfUmbra','HubMotherboard','HubColossus','HubCastleHigh','HubWeredragon','HubAndaluria','HubHorizon','HubCustom']
OLDSPAN='<span style="width: 52px; height: 52px; flex: none; border-radius: 12px; background: #1f2d32; border: 1px dashed #3a4d54; display: flex; align-items: center; justify-content: center; font-family: \'Cinzel\', serif; font-size: 22px; font-weight: 700; color: #c8d3d0">{{ pc.initial }}</span>'
NEWSPAN='<span aria-hidden="true" style="{{ pc.faceStyle }}">{{ pc.faceInitial }}</span>'
for h in HUBS:
    f=P+h+'.dc.html'; s=open(f).read()
    s=R(s,OLDSPAN,NEWSPAN)
    s=R(s,"initial: (f.name || clsName).charAt(0).toUpperCase(),",
        "initial: (f.name || clsName).charAt(0).toUpperCase(),\n        ...(() => { const art = portraitCss(f); return { faceInitial: art ? '' : (f.name || clsName).charAt(0).toUpperCase(), faceStyle: 'width: 76px; height: 76px; flex: none; border-radius: 14px; box-sizing: border-box; background-color: #1f2d32; background-size: cover; background-repeat: no-repeat; border: ' + (art ? '2px solid #4a5f66' : '1px dashed #3a4d54') + '; display: flex; align-items: center; justify-content: center; font-family: \\'Cinzel\\', serif; font-size: 26px; font-weight: 700; color: #c8d3d0; ' + art }; })(),")
    s=R(s,"class Component extends DCLogic {",HELP+"class Component extends DCLogic {")
    open(f,'w').write(s); print('hub',h)
# Party roster
f=P+'Party.dc.html'; s=open(f).read()
old='<div style="padding: 16px; display: flex; flex-direction: column; gap: 10px">\n<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-family: \'Cinzel\', serif; font-size: 22px; font-weight: 700">{{ r.name }}</span>'
new='<div class="rp-face" aria-hidden="true" style="{{ r.faceStyle }}"><span class="rp-init">{{ r.faceInitial }}</span></div>\n'+old
s=R(s,old,new)
s=R(s,'</style>','.rp-face{position:relative;height:220px;background-color:#1b282d;background-size:cover;background-repeat:no-repeat;display:flex;align-items:center;justify-content:center}\n.rp-face::after{content:"";position:absolute;left:0;right:0;bottom:0;height:70px;background:linear-gradient(0deg,#141e22,rgba(20,30,34,0))}\n.rp-init{font-family:\'Cinzel\',serif;font-size:72px;font-weight:900;color:rgba(246,234,210,.35)}\n</style>')
s=R(s,"name: c.f.name || 'Unnamed hero',\n        heritage:","name: c.f.name || 'Unnamed hero',\n        ...(() => { const art = portraitCss(c.f); return { faceStyle: art || ('background: linear-gradient(rgba(10, 16, 18, 0.5), rgba(10, 16, 18, 0.5)), ' + k.bannerBg + ';'), faceInitial: art ? '' : (c.f.name || k.id).charAt(0).toUpperCase() }; })(),\n        heritage:")
i=s.index('class Component extends DCLogic {'); s=s[:i]+HELP+s[i:]
open(f,'w').write(s); print('party')
