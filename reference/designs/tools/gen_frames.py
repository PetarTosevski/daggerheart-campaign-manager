import json, re, sys, os
S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
PROJ=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/'
FR={
 'fivebanners':('FiveBanners','5273dcaa00f81a748be4d8404ef72b6e','Core Rulebook','60% 40%'),
 'beastfeast':('BeastFeast','9ad463b1fc72771176578d77da20984f','Core Rulebook','30% center'),
 'umbra':('AgeOfUmbra','53d3e7877e8e687107b1d80149685979','Core Rulebook','70% center'),
 'motherboard':('Motherboard','0b895f62874c5481f3b92d0cd284d3e9','Core Rulebook','center'),
 'colossus':('Colossus','bf68d5cb6c5931e18f23260203309a75','Core Rulebook','center'),
 'castlehigh':('CastleHigh','3514a8aae6b8c0148b3c1df43a1999dd','Hope & Fear','center'),
 'weredragon':('Weredragon','4b69baa5c3ea604607e14579c982c9e9','Hope & Fear','center'),
 'andaluria':('Andaluria','b05e2883f26c65020e038349a2ba07ba','Hope & Fear','center'),
 'horizon':('Horizon','b0cd8d347b032b78f2c527ddcce21f51','Hope & Fear','center'),
}
def js(o):
    s=json.dumps(o,ensure_ascii=False)
    return s.replace('}}','} }').replace('{{','{ {')
def esc(t): return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
tome_src=open(PROJ+'TomeOpenBook.dc.html').read()
hub_src=open(PROJ+'CampaignHub.dc.html').read()
def rep(s,a,b,n=1):
    assert s.count(a)==n,(s.count(a),a[:120]); return s.replace(a,b)
def build_tome(key,d):
    stem,blob,book,pos=FR[key]; s=tome_src
    s=rep(s,'<title>Witherwild Tome · Open Book</title>','<title>'+esc(d['name'])+' Tome · Open Book</title>')
    s=rep(s,'.ww-bg{background-image:url(/_blob/d69136bf0c8eddbad10c2eb636b1b5ca);background-size:cover;background-position:center;','.ww-bg{background-image:url(/_blob/'+blob+');background-size:cover;background-position:'+pos+';')
    s=rep(s,'Campaign Frame · Core Rulebook','Campaign Frame · '+esc(book).replace('&amp;','&amp;'))
    s=rep(s,'>The Witherwild</h2>','>'+esc(d['name'])+'</h2>')
    # key figures + start
    a=s.index('<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px">'); b=s.index('</div>\n<div style="align-self: flex-start;',a)
    s=s[:a]+'<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px">\n<sc-for list="{{ keyFigures }}" as="k" hint-placeholder-count="3"><div style="padding: 12px 14px; background: #e3d2ad; border: 1px solid #cdb88f; border-radius: 6px; display: flex; flex-direction: column; gap: 3px"><span style="font-family: \'Cinzel\', serif; font-size: 16px; font-weight: 700; line-height: 1.25">{{ k.name }}</span><span style="font-size: 14px; color: #6a5236">{{ k.role }}</span><span style="font-size: 15px; line-height: 1.4">{{ k.line }}</span></div></sc-for>\n'+s[b:]
    s=rep(s,'Start: the treetop village of Alula</div>','Start: {{ startAt }}</div>')
    s=rep(s,'<sc-if value="{{ isIncident }}" hint-placeholder-val="{{ false }}">\n<div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 4px">','<sc-if value="{{ hasFigures }}" hint-placeholder-val="{{ false }}">\n<div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 4px">')
    # mechanics: drop the wither "you'll need" box
    a=s.index('<div style="display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 8px; background: #2f4a3a; color: #eef3ea">'); b=s.index('<sc-for list="{{ rules }}"',a)
    s=s[:a]+s[b:]
    s=rep(s,'<span style="font-size: 18px; line-height: 1.55">{{ r.t }}</span>','<span style="font-size: 18px; line-height: 1.55; white-space: pre-line">{{ r.t }}</span>')
    s=rep(s,'color: #5a2a1a">The same walls that brought the city security became the crucible that incubated a virulent plague.</blockquote>','color: #5a2a1a">{{ pullQuote }}</blockquote>')
    # data
    a=s.index('    const chapters = ['); b=s.index('    const c = chapters[idx];')
    pg=d.get('pages',{}); ref=lambda k: (' Summarized here; full text in the '+book+', '+pg[k]+'.') if pg.get(k) else ''
    chapters=[{'roman':'I','title':'Overview','note':d['overviewNote']+ref('overview'),'paras':d['overview']},
              {'roman':'II','title':'The Inciting Incident','note':d['incidentNote']+ref('incident'),'paras':d['incident']},
              {'roman':'III','title':'Campaign Mechanics','sub':d.get('mechanicsSub') or '','note':d['mechanicsNote']+ref('mechanics'),'paras':['']}]
    rules=[{'n':str(i+1),'head':m['head'],'t':m['t']} for i,m in enumerate(d['mechanics'])]
    s=s[:a]+'    const chapters = '+js(chapters)+';\n    const rules = '+js(rules)+';\n    const FIG = '+js(d.get('keyFigures',[]))+';\n'+s[b:]
    s=rep(s,"const cur = { ...c, hasSub: !!c.sub, cap: c.paras[0].charAt(0), capRest: c.paras[0].slice(1), rest: c.paras.slice(1).map((t) => ({ t })) };",
            "const p0 = c.paras[0] || ''; const cur = { ...c, hasSub: !!c.sub, cap: p0.charAt(0), capRest: p0.slice(1), rest: c.paras.slice(1).map((t) => ({ t })) };")
    s=rep(s,"      open, closed: !open, cur, tabs, rules,","      open, closed: !open, cur, tabs, rules, keyFigures: FIG, hasFigures: idx === 1 && FIG.length > 0, startAt: "+js(d.get('start') or '')+", pullQuote: "+js(d.get('pullQuote') or '')+", mechIntro: "+js(d['mechanicsNote'])+",")
    s=rep(s,"isOverview: idx === 0,","isOverview: idx === 0 && "+('true' if d.get('pullQuote') else 'false')+",")
    s=s.replace("background: #0a1416; ')","background: #0a1416; ')")
    return s
def build_hub(key,d):
    stem,blob,book,pos=FR[key]; s=hub_src
    s=rep(s,'<title>Campaign · The Witherwild</title>','<title>Campaign · '+esc(d['name'])+'</title>')
    s=rep(s,'.ww-bg{background-image:url(/_blob/d69136bf0c8eddbad10c2eb636b1b5ca);background-size:cover;background-position:center 45%;','.ww-bg{background-image:url(/_blob/'+blob+');background-size:cover;background-position:'+pos+';')
    # remove long-cycle time section
    a=s.index('<section aria-label="Time of the long cycle"'); b=s.index('</section>',a)+len('</section>\n')
    s=s[:a]+s[b:]
    s=rep(s,'Active Campaign · The Witherwild','Active Campaign · '+esc(d['name']))
    # remove creep overlay and wither strip on PC cards
    a=s.index('<sc-if value="{{ pc.creep.on }}"'); b=s.index('</div></sc-if>\n',a)+len('</div></sc-if>\n'); s=s[:a]+s[b:]
    a=s.index('<div aria-label="{{ pc.witherAria }}"'); b=s.index('</article>',a); s=s[:a]+s[b:]
    # remove wither panel
    a=s.index('<section aria-labelledby="wither-h"'); b=s.index('</section>',a)+len('</section>\n'); s=s[:a]+s[b:]
    # key figures
    a=s.index('<div style="display: flex; flex-direction: column; gap: 2px">\n<div style="padding: 10px 0; border-bottom: 1px solid #22303a;'); b=s.index('</section>',a)
    figs=d.get('keyFigures',[])
    items=''.join('<div style="padding: 10px 0;'+(' border-bottom: 1px solid #22303a;' if i<len(figs)-1 else '')+' display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 600">'+esc(f['name'])+'</span><span style="font-size: 13px; color: #9fb2b6">'+esc(f['role'])+'</span></div>\n' for i,f in enumerate(figs))
    s=s[:a]+'<div style="display: flex; flex-direction: column; gap: 2px">\n'+items+'</div>\n'+s[b:]
    s=rep(s,'<dc-import name="TomeOpenBook"','<dc-import name="Tome'+stem+'"')
    s=rep(s,'placeholder="Countdown name (e.g. The Fanewraith strikes Alula)"','placeholder="Countdown name"')
    # JS: drop wither + long-cycle logic
    a=s.index('        witherAria: '); b=s.index("        witherDown: () => setPc(i, { wither: Math.max(0, p.wither - 1) })\n",a)+len("        witherDown: () => setPc(i, { wither: Math.max(0, p.wither - 1) })\n")
    s=s[:a]+"        _x: 0\n"+s[b:]
    s=rep(s,"    const witherTotal = pcsState.reduce((s, p) => s + p.wither, 0);\n","")
    a=s.index("    const TMKEY = 'dh.witherwild.time';"); b=s.index("    const LOCICON = ")
    s=s[:a]+s[b:]
    s=rep(s,"      witherTotal, witherPool: Math.max(0, 20 - witherTotal),\n      endSession: () => save(pcsState.map((p) => ({ ...p, wither: 0 })), { fear: keepFear(Math.min(12, fear + witherTotal)) }),\n","")
    s=rep(s,"      tm, locations,","      locations,")
    s=rep(s,',"weeksPerMonth":{"editor":"int","min":1,"max":12,"default":4}','')
    s=rep(s,"const CDKEY = 'dh.witherwild.countdowns';","const CDKEY = 'dh."+key+".countdowns';")
    s=rep(s,"window.localStorage.getItem('dh.witherwild.map')","window.localStorage.getItem('dh."+key+".map')")
    s=rep(s,"window.localStorage.setItem('dh.witherwild.mapFocus'","window.localStorage.setItem('dh."+key+".mapFocus'")
    s=rep(s,"const pcsState = chars.map((c) => ({ ...c, wither: c.wither || 0 }));","const pcsState = chars.map((c) => ({ ...c }));")
    s=rep(s,"        wither: p.wither,\n","")
    s=rep(s,'const ACTIVE = {"key": "witherwild", "hub": "CampaignHub.dc.html", "name": "The Witherwild", "blob": "d69136bf0c8eddbad10c2eb636b1b5ca" };',
          'const ACTIVE = '+json.dumps({'key':key,'hub':'Hub'+stem+'.dc.html','name':d['name'],'blob':blob}).replace('}',' }')+';')
    s=rep(s,"const KEY = 'dh.witherwild.party';","const KEY = 'dh."+key+".party';")
    s=rep(s,"const FEARKEY = 'dh.witherwild.fear';","const FEARKEY = 'dh."+key+".fear';")
    s=rep(s,"if (e.key === 'dh.witherwild.fear')","if (e.key === 'dh."+key+".fear')")
    s=rep(s,"'dh.witherwild.sessions'","'dh."+key+".sessions'")
    left=[m.start() for m in re.finditer('wither',re.sub(r'<style>.*?</style>','',s,flags=re.S))]
    assert not left, left
    return s
if __name__=='__main__':
    keys=sys.argv[1:] or list(FR)
    for k in keys:
        p=S+'tome_data/'+k+'.json'
        if not os.path.exists(p): print('missing',k); continue
        d=json.load(open(p)); stem=FR[k][0]
        open(PROJ+'Tome'+stem+'.dc.html','w').write(build_tome(k,d))
        open(PROJ+'Hub'+stem+'.dc.html','w').write(build_hub(k,d))
        fp=PROJ+stem+'.dc.html'; fs=open(fp).read()
        old='<button type="button" style="min-height: 52px; padding: 0 28px; border-radius: 999px; border: none; background: {{accent}}; color: #1a1408; font-family: \'Cinzel\', serif; font-size: 16px; font-weight: 700; letter-spacing: 0.1em; cursor: pointer">Choose this Frame</button>'
        new='<a href="Hub'+stem+'.dc.html" style="min-height: 52px; padding: 0 28px; border-radius: 999px; border: none; background: {{accent}}; color: #1a1408; font-family: \'Cinzel\', serif; font-size: 16px; font-weight: 700; letter-spacing: 0.1em; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box">Choose this Frame</a>'
        if old in fs: open(fp,'w').write(fs.replace(old,new)); print('linked',stem)
        print('built',k)
