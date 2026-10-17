import re,json
S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
P=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/'
HUBS=['CampaignHub','HubFiveBanners','HubBeastFeast','HubAgeOfUmbra','HubMotherboard','HubColossus','HubCastleHigh','HubWeredragon','HubAndaluria','HubHorizon','HubCustom']
CUSTOM_BL={'custom':'f3205851cb5f0694dec14556bfd1988e','witherwild':'d69136bf0c8eddbad10c2eb636b1b5ca','fivebanners':'5273dcaa00f81a748be4d8404ef72b6e','beastfeast':'9ad463b1fc72771176578d77da20984f','umbra':'53d3e7877e8e687107b1d80149685979','motherboard':'0b895f62874c5481f3b92d0cd284d3e9','colossus':'bf68d5cb6c5931e18f23260203309a75','castlehigh':'3514a8aae6b8c0148b3c1df43a1999dd','weredragon':'4b69baa5c3ea604607e14579c982c9e9','andaluria':'b05e2883f26c65020e038349a2ba07ba','horizon':'b0cd8d347b032b78f2c527ddcce21f51'}
def R(s,a,b):
    assert s.count(a)==1,(s.count(a),a[:100]); return s.replace(a,b)
OLDNAV_A="const navItems = ['Dashboard', 'Party', 'Sessions', 'Adversaries', 'World', 'Notes'].map((label) => {"
OLDNAV_B="      const isLink = label === 'Party' || label === 'World' || label === 'Adversaries';\n      return { label, isLink, isBtn: !isLink, href: label === 'World' ? 'World.dc.html' : label === 'Adversaries' ? 'Adversaries.dc.html' : 'Party.dc.html',"
NEWNAV_B="      const isLink = label === 'Party' || label === 'World' || label === 'Adversaries' || label === 'Sessions';\n      return { label, isLink, isBtn: !isLink, href: label === 'World' ? 'World.dc.html' : label === 'Adversaries' ? 'Adversaries.dc.html' : label === 'Sessions' ? 'Sessions.dc.html' : 'Party.dc.html',"
for h in HUBS:
    f=P+h+'.dc.html'; s=open(f).read()
    key=re.search(r"const CDKEY = 'dh\.([a-z]+)\.countdowns'",s).group(1)
    name=re.search(r'<title>Campaign · ([^<]*)</title>',s).group(1).replace('&amp;','&')
    blob=re.search(r'\.ww-bg\{background-image:url\(/_blob/([0-9a-f]+)\)',s).group(1)
    s=R(s,OLDNAV_A,"const navItems = ['Dashboard', 'Party', 'World', 'Adversaries', 'Sessions', 'Notes'].map((label) => {")
    s=R(s,OLDNAV_B,NEWNAV_B)
    # start session -> link
    m=re.search(r'<button type="button" (style="min-height: 52px; padding: 0 30px;[^"]*")>Start Session</button>',s)
    st=m.group(1).replace('cursor: pointer"','cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; box-sizing: border-box"')
    s=s.replace(m.group(0),'<a href="Sessions.dc.html" onClick="{{ startSession }}" '+st+'>Start Session</a>')
    s=R(s,'<span>Session [#]</span>','<span>{{ sessInfo.num }}</span>')
    s=R(s,'<span>Next session [date]</span>','<span>{{ sessInfo.next }}</span>')
    m=re.search(r'<button type="button" (style="min-height: 44px; padding: 0 16px;[^"]*")>Session notes</button>',s)
    st=m.group(1).replace('cursor: pointer;','cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; box-sizing: border-box;')
    s=s.replace(m.group(0),'<a href="Sessions.dc.html" '+st+'>All sessions</a>')
    s=R(s,'[Recap of the last session: where the party stands, who they met, and what threat looms next.]','{{ sessInfo.recap }}')
    if key=='custom':
        act="{ key: 'custom', hub: 'HubCustom.dc.html', name: campaignName, blob: "+json.dumps(CUSTOM_BL)+"[(CU.art || 'custom')] || '"+CUSTOM_BL['custom']+"' }"
    else:
        act=json.dumps({'key':key,'hub':h+'.dc.html','name':name,'blob':blob}).replace('}',' }')
    js=("    const ACTIVE = "+act+";\n"
        "    try { if (window.localStorage.getItem('dh.active') !== JSON.stringify(ACTIVE)) window.localStorage.setItem('dh.active', JSON.stringify(ACTIVE)); } catch (e) {}\n"
        "    const sessInfo = (() => { let ss = []; try { ss = JSON.parse(window.localStorage.getItem('dh." + key + ".sessions') || '[]') || []; } catch (e) {} if (!Array.isArray(ss)) ss = [];\n"
        "      const playedS = ss.filter((x) => x.played); const last = playedS[playedS.length - 1]; const nxt = ss.find((x) => !x.played && x.date);\n"
        "      const fd = (d) => { const t = new Date(d + 'T12:00:00'); return isNaN(t) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };\n"
        "      return { num: ss.length ? 'Session ' + (playedS.length + (ss.some((x) => !x.played) ? 1 : 0) || 1) : 'No sessions yet', next: nxt ? 'Next session ' + fd(nxt.date) : 'Next session not scheduled',\n"
        "        recap: last && (last.recap || '').trim() ? last.recap : (last ? 'Session ' + last.n + ' was played, but no recap was written. Add one in the session\\'s Wrap-up.' : 'No sessions played yet. Write a recap in a session\\'s Wrap-up stage and it will appear here.') }; })();\n")
    i=s.index("    const section = st.section || 'Dashboard';")
    s=s[:i]+js+s[i:]
    s=R(s,"      accent, pcs, fear,","      sessInfo, startSession: () => { try { window.localStorage.setItem('dh.sessions.intent', 'play'); } catch (e) {} },\n      accent, pcs, fear,")
    assert '}}' not in s[s.index('data-dc-script'):].split("'>",1)[1], h
    open(f,'w').write(s); print('patched',h,key)
# Party + World static navs
LINK='style="min-height: 40px; padding: 0 14px; border-radius: 8px; color: #e6ecea; font-size: 14px; text-decoration: none; display: inline-flex; align-items: center"'
def navblock(cur):
    out=[]
    for lab,href in [('Dashboard','{{ dashHref }}'),('Party','Party.dc.html'),('World','World.dc.html'),('Adversaries','Adversaries.dc.html'),('Sessions','Sessions.dc.html'),('Notes',None)]:
        if lab==cur: out.append('<span aria-current="page" style="min-height: 40px; padding: 0 14px; border-radius: 8px; background: {{ navAccent }}; color: #1a1408; font-size: 14px; display: inline-flex; align-items: center">'+lab+'</span>')
        elif href: out.append('<a href="'+href+'" '+LINK+'>'+lab+'</a>')
        else: out.append('<span title="Coming soon" style="min-height: 40px; padding: 0 14px; border-radius: 8px; color: #7f9297; font-size: 14px; display: inline-flex; align-items: center">'+lab+'</span>')
    return '\n'.join(out)+'\n'
DASH="    const dashHref = (() => { try { return (JSON.parse(window.localStorage.getItem('dh.active') || 'null') || {}).hub || 'CampaignHub.dc.html'; } catch (e) { return 'CampaignHub.dc.html'; } })();\n    const navAccent = (() => { try { return (JSON.parse(window.localStorage.getItem('dh.settings') || '{}') || {}).accent; } catch (e) { return null; } })() || '#e3b45a';\n"
for page,cur in [('Party','Party'),('World','World')]:
    f=P+page+'.dc.html'; s=open(f).read()
    a=s.index('<nav aria-label="Campaign sections"'); a=s.index('>',a)+2; b=s.index('</nav>',a)
    s=s[:a]+navblock(cur)+s[b:]
    # inject into renderVals return
    m=re.search(r'renderVals\(\) \{\n',s); i=m.end()
    s=s[:i]+DASH+s[i:]
    # add to returned object: find first "return {" after renderVals at 4-space indent
    j=s.index('\n    return {',i)+len('\n    return {')
    s=s[:j]+' dashHref, navAccent,'+s[j:]
    open(f,'w').write(s); print('nav',page)
