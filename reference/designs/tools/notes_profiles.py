S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/Notes.dc.html'; s=open(f).read()
def R(a,b):
    global s; assert s.count(a)==1,(s.count(a),a[:90]); s=s.replace(a,b)
R("    const JK = 'dh.' + act.key + '.journal';",
r"""    // ---- whose journal: the GM or one of the party's players; each has their own pages
    const party = (() => { const v = ls('dh.' + act.key + '.party', []); return Array.isArray(v) ? v : []; })();
    const slug = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hero';
    const profiles = [{ id: 'gm', name: 'Game Master', sub: 'GM' }].concat(party.filter((c) => !c.dead).map((c, i) => ({ id: 'pc-' + slug(c.f && c.f.name || 'hero-' + (i + 1)), name: (c.f && c.f.name) || 'Hero ' + (i + 1), sub: c.clsName || 'Player' })));
    const WHOKEY = 'dh.' + act.key + '.journalWho';
    let who = st.who || (() => { try { return window.localStorage.getItem(WHOKEY) || 'gm'; } catch (e) { return 'gm'; } })();
    if (!profiles.some((p) => p.id === who)) who = 'gm';
    const me = profiles.find((p) => p.id === who);
    const isGmJ = who === 'gm';
    const PINKEY = 'dh.' + act.key + '.journalPins'; const pins = ls(PINKEY, {}) || {};
    const hash = (t) => { let h = 5381; const x = String(t) + '|' + act.key; for (let i = 0; i < x.length; i++) h = ((h * 33) ^ x.charCodeAt(i)) >>> 0; return h.toString(16); };
    this._unlocked = this._unlocked || {};
    const locked = !!pins[who] && !this._unlocked[who];
    const JK = 'dh.' + act.key + '.journal' + (isGmJ ? '' : '.' + who);""")
R("""        J = { pages: [{ id: uid('p'), kind: 'log', title: 'Session 1', tape: 0, created: now, entries: [] }, { id: uid('p'), kind: 'collection', title: 'Rumors & hooks', tape: 1, created: now, entries: [] }, { id: uid('p'), kind: 'collection', title: 'Loot & debts', tape: 2, created: now, entries: [] }, { id: uid('p'), kind: 'future', title: 'Future log', tape: 3, created: now, entries: [] }] };""",
"""        J = isGmJ ? { pages: [{ id: uid('p'), kind: 'log', title: 'Session 1', tape: 0, created: now, entries: [] }, { id: uid('p'), kind: 'collection', title: 'Rumors & hooks', tape: 1, created: now, entries: [] }, { id: uid('p'), kind: 'collection', title: 'Loot & debts', tape: 2, created: now, entries: [] }, { id: uid('p'), kind: 'future', title: 'Future log', tape: 3, created: now, entries: [] }] }
          : { pages: [{ id: uid('p'), kind: 'log', title: 'Session 1', tape: 2, created: now, entries: [] }, { id: uid('p'), kind: 'collection', title: 'People we met', tape: 1, created: now, entries: [] }, { id: uid('p'), kind: 'collection', title: 'Clues & secrets', tape: 4, created: now, entries: [] }, { id: uid('p'), kind: 'collection', title: 'My goals', tape: 0, created: now, entries: [] }] };""")
R("    let J = st.J;","    let J = st.J && st.Jwho === who ? st.J : null;")
R("    const save = (j, extra) => { try { window.localStorage.setItem(JK, JSON.stringify(j)); } catch (e) {} this.setState({ J: j, ...(extra || {}) }); };",
  "    const save = (j, extra) => { try { window.localStorage.setItem(JK, JSON.stringify(j)); } catch (e) {} this.setState({ J: j, Jwho: who, ...(extra || {}) }); };")
R("const refs = [].concat((codex.chars || []).map(","const known = (e) => isGmJ || !!e.known;\n    const refs = [].concat((codex.chars || []).filter(known).map(")
R("(codex.locs || []).map((e) => ({ id: e.id, kind: 'locs'","(codex.locs || []).filter(known).map((e) => ({ id: e.id, kind: 'locs'")
# expose profile UI
R("      accent, navItems, groups,",
r"""      accent, navItems, groups,
      locked, unlocked: !locked, whoName: me.name, whoSub: isGmJ ? 'GM journal · private to the GM' : 'Player journal · ' + me.sub,
      profiles: profiles.map((p) => { const on = p.id === who; return { name: p.name, sub: p.sub, lock: pins[p.id] ? '🔒' : '', initial: p.name.charAt(0).toUpperCase(), current: on ? 'true' : 'false',
        pick: () => { try { window.localStorage.setItem(WHOKEY, p.id); } catch (e) {} this.setState({ who: p.id, J: null, Jwho: null, page: null, threads: false, editing: null, pinErr: '', pinMode: null }); },
        style: 'min-height: 46px; display: inline-flex; align-items: center; gap: 10px; padding: 4px 14px 4px 4px; border-radius: 999px; cursor: pointer; font-family: inherit; color: #e6ecea; background: ' + (on ? '#1b282d' : 'rgba(0, 0, 0, 0.3)') + '; border: 1.5px solid ' + (on ? accent : 'rgba(255, 255, 255, 0.2)') + ';',
        avatar: 'width: 36px; height: 36px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-family: \'Cinzel\', serif; font-weight: 700; color: #1a1408; background: ' + (p.id === 'gm' ? '#c9a8ff' : accent) + ';' }; }),
      pinLabel: pins[who] ? '🔓 Remove lock' : '🔒 Lock with a PIN',
      pinMode: st.pinMode || null, settingPin: st.pinMode === 'set', pinErr: st.pinErr || '',
      togglePin: () => { if (pins[who]) { const np = { ...pins }; delete np[who]; try { window.localStorage.setItem(PINKEY, JSON.stringify(np)); } catch (e) {} this.setState({ pinMode: null, tick: Date.now() }); } else this.setState({ pinMode: st.pinMode === 'set' ? null : 'set', pinErr: '' }); },
      setPinKey: (ev) => { if (ev.key !== 'Enter') return; const v = ev.target.value.trim(); if (v.length < 3) { this.setState({ pinErr: 'Use at least 3 characters.' }); return; } const np = { ...pins, [who]: hash(v) }; try { window.localStorage.setItem(PINKEY, JSON.stringify(np)); } catch (e) {} this._unlocked[who] = true; this.setState({ pinMode: null, pinErr: '' }); },
      unlockKey: (ev) => { if (ev.key !== 'Enter') return; if (hash(ev.target.value.trim()) === pins[who]) { this._unlocked[who] = true; this.setState({ pinErr: '', tick: Date.now() }); } else { ev.target.value = ''; this.setState({ pinErr: 'That is not the right PIN.' }); } },
      lockNow: () => { this._unlocked[who] = false; this.setState({ tick: Date.now() }); }, canLockNow: !!pins[who] && !locked,""")
# header: show whose journal + switcher
R("""<h1 style="margin: 0; font-family: 'Cinzel', serif; font-size: 44px; line-height: 1.05; font-weight: 900">The Journal</h1>
<div style="font-size: 15px; color: #d6dfdc">{{ headerLine }}</div>""",
"""<h1 style="margin: 0; font-family: 'Cinzel', serif; font-size: 44px; line-height: 1.05; font-weight: 900">{{ whoName }}’s Journal</h1>
<div style="font-size: 15px; color: #d6dfdc">{{ whoSub }} · {{ headerLine }}</div>""")
R("""<button type="button" onClick="{{ showThreads }}" aria-pressed="{{ threadsPressed }}" style="{{ threadsBtn }}">🧵 Open threads · {{ openCount }}</button>
</div>
</div>
</div>
</section>""",
"""<sc-if value="{{ unlocked }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ showThreads }}" aria-pressed="{{ threadsPressed }}" style="{{ threadsBtn }}">🧵 Open threads · {{ openCount }}</button></sc-if>
</div>
</div>
<div role="group" aria-label="Whose journal" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">
<span style="font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: #c8d3d0; margin-right: 4px">Writing as</span>
<sc-for list="{{ profiles }}" as="pf" hint-placeholder-count="4"><button type="button" onClick="{{ pf.pick }}" aria-pressed="{{ pf.current }}" style="{{ pf.style }}"><span aria-hidden="true" style="{{ pf.avatar }}">{{ pf.initial }}</span><span style="display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15"><span style="font-weight: 600; font-size: 14px">{{ pf.name }} {{ pf.lock }}</span><span style="font-size: 11px; color: #9fb2b6">{{ pf.sub }}</span></span></button></sc-for>
<span style="flex: 1"></span>
<sc-if value="{{ unlocked }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ togglePin }}" style="min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(0, 0, 0, 0.3); color: #e6ecea; font-family: inherit; font-size: 13px; cursor: pointer">{{ pinLabel }}</button></sc-if>
<sc-if value="{{ canLockNow }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ lockNow }}" style="min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(0, 0, 0, 0.3); color: #e6ecea; font-family: inherit; font-size: 13px; cursor: pointer">Close &amp; lock</button></sc-if>
<sc-if value="{{ settingPin }}" hint-placeholder-val="{{ false }}"><input type="password" placeholder="New PIN, then Enter" aria-label="New PIN" onKeyDown="{{ setPinKey }}" style="min-height: 38px; padding: 0 12px; border-radius: 999px; border: 1px solid #e3b45a; background: #0b1214; color: #e6ecea; font-family: inherit; font-size: 14px; width: 190px"></sc-if>
<sc-if value="{{ pinErr }}" hint-placeholder-val="{{ false }}"><span role="alert" style="color: #ffb4a8; font-size: 13px">{{ pinErr }}</span></sc-if>
</div>
</div>
</section>""")
# lock screen + hide main when locked
R("""<main style="flex: 1; width: 100%; max-width: 1344px; margin: 0 auto; padding: 28px 48px 56px;""",
"""<sc-if value="{{ locked }}" hint-placeholder-val="{{ false }}"><div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px"><div class="bj-paper" style="min-height: 0; width: 100%; max-width: 520px; text-align: center; padding: 56px 40px 40px"><div class="bj-tape" style="background: repeating-linear-gradient(45deg, #c9a8ff 0 10px, #b894f0 10px 20px)">Private</div><p style="font-family: 'Caveat', cursive; font-size: 28px; margin: 0 0 16px">This journal belongs to {{ whoName }}.</p><input type="password" placeholder="Enter PIN and press Enter" aria-label="PIN" onKeyDown="{{ unlockKey }}" style="width: 100%; box-sizing: border-box; min-height: 46px; padding: 0 14px; border-radius: 10px; border: 1.5px solid #cdb88f; background: #fffaf0; color: #2a1f14; font-size: 16px; font-family: inherit"></div></div></sc-if>
<sc-if value="{{ unlocked }}" hint-placeholder-val="{{ true }}">
<main style="flex: 1; width: 100%; max-width: 1344px; margin: 0 auto; padding: 28px 48px 56px;""")
R("""</section>
</main>
</div>
</x-dc>""","""</section>
</main>
</sc-if>
</div>
</x-dc>""")
open(f,'w').write(s); print('ok')
