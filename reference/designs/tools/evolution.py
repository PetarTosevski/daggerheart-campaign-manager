S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/Party.dc.html'; s=open(f).read()
def R(a,b,n=1):
    global s; assert s.count(a)==n,(s.count(a),a[:90]); s=s.replace(a,b)
# Druid: open the Beastform sheet instead of the trait picker
R("        if (id === 'Seraph' || id === 'Druid') { this.setState({ hfPick: id, hfMsg: '' }); return; }",
  "        if (id === 'Druid') { this.setState({ cs: 'beast', evoPending: true, hfMsg: '', hfPick: null }); return; }\n        if (id === 'Seraph') { this.setState({ hfPick: id, hfMsg: '' }); return; }")
# trait pick after transforming: hope already spent
R("          pick: () => spend({ hfx: addFx({ name, text: '+1 ' + label + ' while in Beastform', until: 'beast', undo: { trait: k } }), f: { ...ch.f, [k]: bumpMod(ch.f[k], 1) } }, name + ': transform without marking Stress; ' + label + ' +1 until you drop out of Beastform.') })),",
  "          pick: () => { upd({ hfx: addFx({ name, text: '+1 ' + label + ' while in Beastform', until: 'beast', undo: { trait: k } }), f: { ...ch.f, [k]: bumpMod(ch.f[k], 1) } }); this.setState({ hfPick: null, hfMsg: name + ': ' + label + ' +1 until you drop out of ' + (ch.f.beastform || 'Beastform') + '.' }); } })),")
R("pickAlly: pick === 'Seraph', pickTrait: pick === 'Druid', cancelPick: () => this.setState({ hfPick: null }),",
  "pickAlly: pick === 'Seraph', pickTrait: pick === 'Druid', cancelPick: () => this.setState({ hfPick: null, hfMsg: pick === 'Druid' ? 'Evolution: no trait raised.' : '' }),")
# beastform transform: Evolution path (no Stress, spend Hope) and drop-out reverting Evolution
R("""            act: () => { if (!ok) return; if (on) { upd({ f: { ...f, beastform: '' } }); return; }
              upd({ f: { ...f, beastform: b.n }, stress: Math.min(ch.stressMax || 6, (ch.stress || 0) + 1) }); } }; }) }));""",
"""            act: () => { if (!ok) return; if (on) { dropBeast(); return; }
              if (st.evoPending) { if ((ch.hope || 0) < 3) { this.setState({ evoPending: false }); return; } upd({ f: { ...f, beastform: b.n }, hope: (ch.hope || 0) - 3 }); this.setState({ evoPending: false, cs: null, page: 1, hfPick: 'Druid', hfMsg: 'Evolution: you became a ' + b.n + ' without marking Stress. Now raise one trait by +1.' }); return; }
              upd({ f: { ...f, beastform: b.n }, stress: Math.min(ch.stressMax || 6, (ch.stress || 0) + 1) }); } }; }) }));""")
R("      const active = f.beastform || '';","""      const active = f.beastform || '';
      const dropBeast = () => { if (!ch) return; const F = { ...ch.f, beastform: '' }; const fx0 = Array.isArray(ch.hfx) ? ch.hfx : []; const keep = []; fx0.forEach((x) => { if (x.until === 'beast') { if (x.undo && x.undo.trait) { const n = (parseInt(String(F[x.undo.trait] || '0').replace('+', ''), 10) || 0) - 1; F[x.undo.trait] = (n >= 0 ? '+' : '') + n; } } else keep.push(x); }); upd({ f: F, hfx: keep }); };""")
R("drop: () => upd({ f: { ...f, beastform: '' } }) } : { n: '', stats: '', adv: '', drop: () => {} },","drop: () => dropBeast() } : { n: '', stats: '', adv: '', drop: () => {} },\n        bfEvo: !!st.evoPending, bfEvoCancel: () => this.setState({ evoPending: false, cs: null, hfMsg: 'Evolution cancelled. No Hope spent.' }),")
R("closeCs: () => this.setState({ cs: null }),","closeCs: () => this.setState({ cs: null, evoPending: false }),")
# effects 'Dropped out' button should also leave Beastform
R("      const endFx = (x) => { const F = { ...ch.f };","      const endFx = (x) => { const F = { ...ch.f }; if (x.until === 'beast') F.beastform = '';")
# banner in beast overlay
R('<p class="cs-note" style="margin: 0; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,.82); font-style: normal; color: #3b3a36"><strong>Beastform:</strong>',
  '<sc-if value="{{ bfEvo }}" hint-placeholder-val="{{ false }}"><div role="status" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 10px; background: #f3e2bd; border: 2px solid #c9962e; color: #4a3008; font-style: normal"><span style="font-size: 22px">✦</span><span style="flex: 1"><strong>Evolution (3 Hope):</strong> pick a form below. You transform <strong>without marking a Stress</strong>, then choose a trait to raise by +1.</span><button type="button" class="cs-btn alt" onClick="{{ bfEvoCancel }}">Cancel</button></div></sc-if>\n<p class="cs-note" style="margin: 0; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,.82); font-style: normal; color: #3b3a36"><strong>Beastform:</strong>')
open(f,'w').write(s); print('ok')
