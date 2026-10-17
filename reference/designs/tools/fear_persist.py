import re
S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
P=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/'
HUBS=['CampaignHub','HubFiveBanners','HubBeastFeast','HubAgeOfUmbra','HubMotherboard','HubColossus','HubCastleHigh','HubWeredragon','HubAndaluria','HubHorizon','HubCustom']
def R(s,a,b,n=1):
    assert s.count(a)==n,(s.count(a),a[:90]); return s.replace(a,b)
for h in HUBS:
    f=P+h+'.dc.html'; s=open(f).read()
    key=re.search(r"const CDKEY = 'dh\.([a-z]+)\.countdowns'",s).group(1)
    s=R(s,"const fear = st.fear ?? 0;","const FEARKEY = 'dh."+key+".fear'; const fear = st.fear ?? (() => { try { return Math.max(0, Math.min(12, parseInt(window.localStorage.getItem(FEARKEY), 10) || 0)); } catch (e) { return 0; } })();\n    const keepFear = (v) => { try { window.localStorage.setItem(FEARKEY, String(v)); } catch (e) {} return v; };")
    s=R(s,"act: () => this.setState({ fear: k + 1 === fear ? k : k + 1 }),","act: () => this.setState({ fear: keepFear(k + 1 === fear ? k : k + 1) }),")
    if "{ fear: Math.min(12, fear + witherTotal) }" in s:
        s=R(s,"{ fear: Math.min(12, fear + witherTotal) }","{ fear: keepFear(Math.min(12, fear + witherTotal)) }")
    s=R(s,"window.addEventListener('storage', (e) => { if (e.key === KEY) this.setState({ chars: load() }); });","window.addEventListener('storage', (e) => { if (e.key === KEY) this.setState({ chars: load() }); if (e.key === 'dh."+key+".fear') this.setState({ fear: Math.max(0, Math.min(12, parseInt(e.newValue, 10) || 0)) }); });")
    open(f,'w').write(s); print(h,key)
# generator sync
g=S+'gen/gen_frames.py'; gs=open(g).read()
gs=R(gs,"""    s=rep(s,"'dh.witherwild.sessions'",""","""    s=rep(s,"const FEARKEY = 'dh.witherwild.fear';","const FEARKEY = 'dh."+key+".fear';")\n    s=rep(s,"if (e.key === 'dh.witherwild.fear')","if (e.key === 'dh."+key+".fear')")\n    s=rep(s,"'dh.witherwild.sessions'",""")
open(g,'w').write(gs)
