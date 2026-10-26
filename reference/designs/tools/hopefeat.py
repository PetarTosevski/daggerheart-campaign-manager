S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/Party.dc.html'; s=open(f).read()
def R(a,b):
    global s; assert s.count(a)==1,(s.count(a),a[:90]); s=s.replace(a,b)
R("    const advPickUi = (() => {",r"""    // ---- class Hope feature: spend 3 Hope and apply what the sheet can track
    const hfUi = (() => {
      if (!ch) return { on: false };
      const id = cls.id; const hope = ch.hope || 0; const can = hope >= 3;
      const fxs = Array.isArray(ch.hfx) ? ch.hfx : [];
      const NAMES = { Bard: 'Make a Scene', Druid: 'Evolution', Guardian: 'Frontline Tank', Ranger: 'Hold Them Off', Rogue: 'Rogue’s Dodge', Seraph: 'Life Support', Sorcerer: 'Volatile Magic', Warrior: 'No Mercy', Wizard: 'Not This Time', Assassin: 'Deadly Determination', Brawler: 'Square Up', Warlock: 'Patron’s Boon', Witch: 'Witch’s Charm' };
      const REMIND = { Bard: 'Your target is Distracted: −2 to their Difficulty for now. Tell the GM.', Ranger: 'Apply that same attack roll to two more adversaries in range.', Sorcerer: 'Reroll any number of your damage dice on this magic attack.', Wizard: 'The GM rerolls that adversary’s attack or damage roll.', Brawler: 'Your target is temporarily Vulnerable. Tell the GM.', Warlock: 'Reroll the failed roll with advantage.', Witch: 'The failed action roll becomes a success with Fear. The GM gains a Fear.' };
      const name = NAMES[id] || 'Hope feature';
      const spend = (patch, msg, extra) => { upd({ hope: hope - 3, ...(patch || {}) }); this.setState({ hfMsg: msg, hfPick: null, ...(extra || {}) }); };
      const addFx = (fx) => fxs.concat([{ id: 'x' + Date.now().toString(36), ...fx }]);
      const use = () => {
        if (!can) { this.setState({ hfMsg: 'You need 3 Hope to use ' + name + '.' }); return; }
        if (id === 'Guardian') { const a = ch.armor || 0; spend({ armor: Math.max(0, a - 2) }, name + ': cleared ' + Math.min(2, a) + ' Armor Slot' + (Math.min(2, a) === 1 ? '' : 's') + '.'); return; }
        if (id === 'Assassin') { const s0 = ch.stress || 0; spend({ stress: Math.max(0, s0 - 2) }, name + ': cleared ' + Math.min(2, s0) + ' Stress.'); return; }
        if (id === 'Warrior') { spend({ hfx: addFx({ name, text: '+1 to your attack rolls', until: 'rest' }) }, name + ': +1 to attack rolls until your next rest.'); return; }
        if (id === 'Rogue') { spend({ hfx: addFx({ name, text: '+2 Evasion', until: 'hit', undo: { evasion: 2 } }), f: { ...ch.f, evasion: String((parseInt(ch.f.evasion, 10) || 0) + 2) } }, name + ': +2 Evasion until an attack hits you or you rest.'); return; }
        if (id === 'Seraph' || id === 'Druid') { this.setState({ hfPick: id, hfMsg: '' }); return; }
        spend(null, name + ': ' + (REMIND[id] || 'Hope spent.'));
      };
      const endFx = (x) => { const F = { ...ch.f }; if (x.undo && x.undo.evasion) F.evasion = String((parseInt(F.evasion, 10) || 0) - x.undo.evasion); if (x.undo && x.undo.trait) F[x.undo.trait] = bumpMod(F[x.undo.trait], -1); upd({ hfx: fxs.filter((y) => y.id !== x.id), f: F }); };
      const allies = chars.map((c, j) => ({ c, j })).filter(({ c, j }) => j !== open && !c.dead);
      const pick = st.hfPick;
      return { on: true, name, can: can ? null : true, btnLabel: '✦ Use ' + name + ' · 3 Hope', use, msg: st.hfMsg || '', hasMsg: !!st.hfMsg,
        btnStyle: 'align-self: flex-start; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1.5px solid #c9962e; font-family: \'Cinzel\', serif; font-size: 14px; font-weight: 700; cursor: ' + (can ? 'pointer' : 'not-allowed') + '; background: ' + (can ? '#f3e2bd' : '#efe6d4') + '; color: ' + (can ? '#5a3a08' : '#a8977a') + ';',
        pickAlly: pick === 'Seraph', pickTrait: pick === 'Druid', cancelPick: () => this.setState({ hfPick: null }),
        noAllies: pick === 'Seraph' && !allies.some(({ c }) => (c.hp || 0) > 0),
        allies: allies.map(({ c, j }) => ({ label: (c.f.name || 'Hero') + ' · ' + (c.hp || 0) + ' HP marked', dis: (c.hp || 0) > 0 ? null : true,
          pick: () => { if (!((c.hp || 0) > 0)) return; const next = chars.map((x, k) => (k === open ? { ...x, hope: hope - 3 } : k === j ? { ...x, hp: Math.max(0, (x.hp || 0) - 1) } : x)); save(next, { hfMsg: name + ': cleared a Hit Point on ' + (c.f.name || 'your ally') + '.', hfPick: null }); } })),
        traits: [['agility', 'Agility'], ['strength', 'Strength'], ['finesse', 'Finesse'], ['instinct', 'Instinct'], ['presence', 'Presence'], ['knowledge', 'Knowledge']].map(([k, label]) => ({ label: label + ' ' + (ch.f[k] || '+0'),
          pick: () => spend({ hfx: addFx({ name, text: '+1 ' + label + ' while in Beastform', until: 'beast', undo: { trait: k } }), f: { ...ch.f, [k]: bumpMod(ch.f[k], 1) } }, name + ': transform without marking Stress; ' + label + ' +1 until you drop out of Beastform.') })),
        effects: fxs.map((x) => ({ text: x.name + ': ' + x.text, until: x.until === 'rest' ? 'until next rest' : x.until === 'hit' ? 'until an attack hits you or your next rest' : 'until you drop out of Beastform', endLabel: x.until === 'hit' ? 'Got hit' : x.until === 'beast' ? 'Dropped out' : 'End', end: () => endFx(x) })),
        hasEffects: fxs.length > 0, anyRest: fxs.some((x) => x.until === 'rest' || x.until === 'hit'),
        rest: () => { const F = { ...ch.f }; const keep = []; fxs.forEach((x) => { if (x.until === 'rest' || x.until === 'hit') { if (x.undo && x.undo.evasion) F.evasion = String((parseInt(F.evasion, 10) || 0) - x.undo.evasion); } else keep.push(x); }); upd({ hfx: keep, f: F }); this.setState({ hfMsg: 'Rested: effects that last until your next rest have ended.' }); } };
    })();
    const advPickUi = (() => {""")
R("      advPick: advPickUi,","      advPick: advPickUi, hf: hfUi,")
MARK='''<sc-if value="{{ hf.on }}" hint-placeholder-val="{{ true }}"><div style="display: flex; flex-direction: column; gap: 8px">
<button type="button" onClick="{{ hf.use }}" disabled="{{ hf.can }}" style="{{ hf.btnStyle }}">{{ hf.btnLabel }}</button>
<sc-if value="{{ hf.hasMsg }}" hint-placeholder-val="{{ false }}"><div role="status" class="sh-small" style="padding: 8px 10px; border-radius: 8px; background: #f3e2bd; border: 1px solid #c9962e; color: #4a3008">{{ hf.msg }}</div></sc-if>
<sc-if value="{{ hf.pickAlly }}" hint-placeholder-val="{{ false }}"><div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center"><span class="sh-small">Clear a Hit Point on which ally (Close range)?</span><sc-for list="{{ hf.allies }}" as="a" hint-placeholder-count="2"><button type="button" onClick="{{ a.pick }}" disabled="{{ a.dis }}" style="min-height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid #a68352; background: #fffaf0; color: #2a1f14; cursor: pointer; font-family: inherit">{{ a.label }}</button></sc-for><sc-if value="{{ hf.noAllies }}" hint-placeholder-val="{{ false }}"><span class="sh-small">No ally has a marked Hit Point.</span></sc-if><button type="button" onClick="{{ hf.cancelPick }}" style="min-height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid #a68352; background: transparent; color: #4a3a26; cursor: pointer; font-family: inherit">Cancel</button></div></sc-if>
<sc-if value="{{ hf.pickTrait }}" hint-placeholder-val="{{ false }}"><div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center"><span class="sh-small">Raise which trait by +1 while in Beastform?</span><sc-for list="{{ hf.traits }}" as="t" hint-placeholder-count="3"><button type="button" onClick="{{ t.pick }}" style="min-height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid #a68352; background: #fffaf0; color: #2a1f14; cursor: pointer; font-family: inherit">{{ t.label }}</button></sc-for><button type="button" onClick="{{ hf.cancelPick }}" style="min-height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid #a68352; background: transparent; color: #4a3a26; cursor: pointer; font-family: inherit">Cancel</button></div></sc-if>
<sc-if value="{{ hf.hasEffects }}" hint-placeholder-val="{{ false }}"><div style="display: flex; flex-direction: column; gap: 6px"><span class="sh-lbl">Active effects</span><sc-for list="{{ hf.effects }}" as="x" hint-placeholder-count="1"><div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: #fffaf0; border: 1px dashed #c9962e"><span style="flex: 1"><strong>{{ x.text }}</strong> <span class="sh-small">({{ x.until }})</span></span><button type="button" onClick="{{ x.end }}" style="min-height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid #a68352; background: transparent; color: #4a3a26; cursor: pointer; font-family: inherit">{{ x.endLabel }}</button></div></sc-for><sc-if value="{{ hf.anyRest }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ hf.rest }}" style="align-self: flex-start; min-height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid #a68352; background: transparent; color: #4a3a26; cursor: pointer; font-family: inherit">Take a rest (ends rest effects)</button></sc-if></div></sc-if>
</div></sc-if>
'''
R('<textarea class="sh-ta" data-key="hopeFeat" defaultValue="{{ f.hopeFeat }}" onChange="{{ setField }}" style="min-height: 72px"></textarea></label>\n</section>',
  '<textarea class="sh-ta" data-key="hopeFeat" defaultValue="{{ f.hopeFeat }}" onChange="{{ setField }}" style="min-height: 72px"></textarea></label>\n'+MARK+'</section>')
open(f,'w').write(s); print('ok')
