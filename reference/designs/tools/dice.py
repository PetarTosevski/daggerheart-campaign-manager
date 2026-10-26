S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/Party.dc.html'; s=open(f).read()
def R(a,b,n=1):
    global s; assert s.count(a)==n,(s.count(a),a[:90]); s=s.replace(a,b)
JS=r"""    // ---- dice: duality dice action rolls + damage rolls, applying Hope / Fear / Stress automatically
    const FEARKEY = 'dh.' + PKEY + '.fear';
    const gmFear = () => { try { return Math.max(0, Math.min(12, parseInt(window.localStorage.getItem(FEARKEY), 10) || 0)); } catch (e) { return 0; } };
    const addGmFear = (n) => { const v = Math.max(0, Math.min(12, gmFear() + n)); try { window.localStorage.setItem(FEARKEY, String(v)); } catch (e) {} return v; };
    const d = (n) => 1 + Math.floor(Math.random() * n);
    const modN = (v) => parseInt(String(v == null || v === '' ? '0' : v).replace('+', ''), 10) || 0;
    const sgn = (n) => (n >= 0 ? '+' : '−') + Math.abs(n);
    const DS = st.dice || {};
    const setDS = (patch) => this.setState({ dice: { ...(this.state.dice || {}), ...patch } });
    const hopeCap = ch ? 6 - (ch.scars || 0) : 6;
    const doAction = (opts) => {
      if (!ch) return; const o = { trait: DS.trait || 'agility', mod: modN(DS.mod), adv: DS.adv || 0, exp: DS.exp || '', diff: parseInt(DS.diff, 10) || 0, ...(opts || {}) };
      const tVal = o.trait === 'none' ? 0 : modN(ch.f[o.trait]); const expMod = o.exp ? modN(ch.f['exp' + o.exp + 'm'] || '+2') : 0;
      let hope = ch.hope || 0; if (o.exp) { if (hope < 1) { setDS({ note: 'Using an Experience costs 1 Hope.' }); return; } hope -= 1; }
      const h = d(12), fr = d(12); const advRolls = Array.from({ length: Math.abs(o.adv) }, () => d(6)); const advVal = o.adv ? (o.adv > 0 ? 1 : -1) * Math.max(...advRolls) : 0;
      const total = h + fr + tVal + o.mod + expMod + advVal; const crit = h === fr; const withHope = !crit && h > fr; const withFear = !crit && fr > h;
      const patch = {}; const lines = [];
      if (crit) { hope = Math.min(hopeCap, hope + 1); patch.stress = Math.max(0, (ch.stress || 0) - 1); lines.push('Critical success! +1 Hope, cleared a Stress.'); }
      else if (withHope) { hope = Math.min(hopeCap, hope + 1); lines.push('Rolled with Hope: +1 Hope.'); }
      else { const v = addGmFear(1); lines.push('Rolled with Fear: the GM gains a Fear (now ' + v + ').'); }
      patch.hope = hope; upd(patch);
      const success = o.diff ? (crit || total >= o.diff) : null;
      const rec = { kind: 'action', h, fr, crit, withHope, withFear, total, adv: o.adv, advRolls, parts: [o.trait !== 'none' ? (o.trait.charAt(0).toUpperCase() + o.trait.slice(1)) + ' ' + sgn(tVal) : '', o.mod ? 'mod ' + sgn(o.mod) : '', o.exp ? (ch.f['exp' + o.exp] || 'Experience') + ' ' + sgn(expMod) : '', o.adv ? (o.adv > 0 ? 'advantage ' : 'disadvantage ') + advRolls.join('/') : ''].filter(Boolean).join(' · '), diff: o.diff, success, lines, opts: o, label: opts && opts.label || '' };
      setDS({ last: rec, hist: [rec].concat(DS.hist || []).slice(0, 6), note: '', exp: '' });
      return rec;
    };
    const parseDmg = (txt) => { const m = /(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i.exec(String(txt || '')); if (!m) return null; return { n: parseInt(m[1], 10) || 1, die: parseInt(m[2], 10), flat: m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0 }; };
    const profNow = ch ? profOf(ch) : 1;
    const wDmg = ch ? parseDmg(ch.f.p1d) : null;
    const dmgDefault = wDmg ? profNow + 'd' + wDmg.die + (wDmg.flat ? (wDmg.flat > 0 ? '+' : '') + wDmg.flat : '') : profNow + 'd8';
    const doDamage = () => { const p = parseDmg(DS.dmg || dmgDefault); if (!p) { setDS({ note: 'Write damage like 2d8+3.' }); return; } const dice = Array.from({ length: Math.min(20, p.n) }, () => d(p.die)); const critBonus = DS.critDmg ? p.n * p.die : 0;
      const rec = { kind: 'damage', die: p.die, dice, flat: p.flat, critBonus, total: dice.reduce((a, b) => a + b, 0) + p.flat + critBonus, expr: p.n + 'd' + p.die + (p.flat ? (p.flat > 0 ? '+' : '') + p.flat : '') + (critBonus ? ' + crit ' + critBonus : '') };
      setDS({ lastDmg: rec, hist: [rec].concat(DS.hist || []).slice(0, 6), sel: [], note: '' }); };
    this._dice = { doAction, last: () => (this.state.dice || {}).last, lastDmg: () => (this.state.dice || {}).lastDmg, setDS, addGmFear };
    const diceUi = (() => {
      if (!ch) return { on: false };
      const L = DS.last; const D = DS.lastDmg; const sel = DS.sel || [];
      const exps = [1, 2, 3, 4, 5].filter((i) => (ch.f['exp' + i] || '').trim());
      return { on: true,
        traits: [['agility', 'Agility'], ['strength', 'Strength'], ['finesse', 'Finesse'], ['instinct', 'Instinct'], ['presence', 'Presence'], ['knowledge', 'Knowledge'], ['none', 'No trait']].map(([v, label]) => ({ v, label: v === 'none' ? label : label + ' ' + (ch.f[v] || '+0') })), trait: DS.trait || 'agility',
        setTrait: (ev) => setDS({ trait: ev.target.value }), mod: DS.mod || '', setMod: (ev) => setDS({ mod: ev.target.value }), diff: DS.diff || '', setDiff: (ev) => setDS({ diff: ev.target.value }),
        exps: [{ v: '', label: 'No Experience' }].concat(exps.map((i) => ({ v: String(i), label: ch.f['exp' + i] + ' ' + (ch.f['exp' + i + 'm'] || '+2') + ' (1 Hope)' }))), exp: DS.exp || '', setExp: (ev) => setDS({ exp: ev.target.value }),
        advText: !DS.adv ? 'Normal' : DS.adv > 0 ? 'Advantage ×' + DS.adv : 'Disadvantage ×' + (-DS.adv), advUp: () => setDS({ adv: Math.min(3, (DS.adv || 0) + 1) }), advDown: () => setDS({ adv: Math.max(-3, (DS.adv || 0) - 1) }),
        roll: () => doAction(), note: DS.note || '', hasNote: !!DS.note,
        hasLast: !!L, lHope: L ? L.h : '', lFear: L ? L.fr : '', lTotal: L ? L.total : '', lParts: L ? L.parts : '', lLines: L ? L.lines.join(' ') : '', lLabel: L && L.label ? L.label : '',
        lOutcome: !L ? '' : L.crit ? 'CRITICAL SUCCESS' : (L.success === true ? 'SUCCESS' : L.success === false ? 'FAILURE' : '') + (L.success != null ? ' · ' : '') + (L.withHope ? 'WITH HOPE' : 'WITH FEAR'),
        lStyle: !L ? '' : 'font-family: \'Cinzel\', serif; font-weight: 900; letter-spacing: .08em; color: ' + (L.crit ? '#8a6a00' : L.withHope ? '#9a6b10' : '#6b3fae') + ';',
        hopeDie: 'width: 54px; height: 54px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-family: \'Cinzel\', serif; font-size: 26px; font-weight: 900; background: linear-gradient(145deg, #f7dc8f, #c9962e); color: #3a2505; box-shadow: inset 0 -3px 0 rgba(0,0,0,.2), 0 2px 6px rgba(0,0,0,.25);' + (L && (L.withHope || L.crit) ? ' outline: 3px solid #c9962e; outline-offset: 2px;' : ''),
        fearDie: 'width: 54px; height: 54px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-family: \'Cinzel\', serif; font-size: 26px; font-weight: 900; background: linear-gradient(145deg, #a98ad8, #4b2a86); color: #f3ecff; box-shadow: inset 0 -3px 0 rgba(0,0,0,.3), 0 2px 6px rgba(0,0,0,.25);' + (L && (L.withFear || L.crit) ? ' outline: 3px solid #6b3fae; outline-offset: 2px;' : ''),
        dmg: DS.dmg || '', dmgPh: dmgDefault, setDmg: (ev) => setDS({ dmg: ev.target.value }), critDmg: DS.critDmg ? 'true' : 'false', toggleCrit: () => setDS({ critDmg: !DS.critDmg }), rollDmg: doDamage,
        hasDmg: !!D, dTotal: D ? D.total : '', dExpr: D ? D.expr : '',
        dDice: D ? D.dice.map((v, i) => { const on = sel.includes(i); return { v: String(v), pressed: on ? 'true' : 'false', pick: () => { if (!DS.rerollMode) return; setDS({ sel: on ? sel.filter((x) => x !== i) : sel.concat(i) }); },
          style: 'min-width: 40px; height: 40px; padding: 0 6px; border-radius: 9px; font-family: \'Cinzel\', serif; font-size: 18px; font-weight: 700; cursor: ' + (DS.rerollMode ? 'pointer' : 'default') + '; border: 2px solid ' + (on ? '#8e2b2b' : '#a68352') + '; background: ' + (on ? '#f3c9c0' : '#fffaf0') + '; color: #2a1f14;' }; }) : [],
        rerollMode: !!DS.rerollMode, rerollLabel: 'Reroll ' + sel.length + ' selected', noSel: sel.length ? null : true,
        doReroll: () => { if (!D) return; const dice = D.dice.map((v, i) => (sel.includes(i) ? d(D.die) : v)); const rec = { ...D, dice, total: dice.reduce((a, b) => a + b, 0) + D.flat + D.critBonus, expr: D.expr + ' (rerolled ' + sel.length + ')' }; setDS({ lastDmg: rec, sel: [], rerollMode: false, note: '' }); },
        cancelReroll: () => setDS({ rerollMode: false, sel: [] }),
        hist: (DS.hist || []).slice(1).map((r) => ({ text: r.kind === 'action' ? 'Action ' + r.total + (r.crit ? ' · critical' : r.withHope ? ' · with Hope' : ' · with Fear') + ' (' + r.h + '/' + r.fr + ')' : 'Damage ' + r.total + ' · ' + r.expr })), hasHist: (DS.hist || []).length > 1,
        gmFear: gmFear() };
    })();
"""
R("    // ---- class Hope feature: spend 3 Hope and apply what the sheet can track", JS+"    // ---- class Hope feature: spend 3 Hope and apply what the sheet can track")
# Hope feature hooks for dice-based classes
R("        if (id === 'Druid') {","""        if (id === 'Sorcerer') { const D0 = this._dice.lastDmg(); if (!D0) { this.setState({ hfMsg: 'Roll damage in the Dice box first, then use Volatile Magic to reroll.' }); return; } spend(null, name + ': click the damage dice you want to reroll, then press Reroll.'); this._dice.setDS({ rerollMode: true, sel: [] }); return; }
        if (id === 'Warlock') { const L0 = this._dice.last(); if (!L0) { this.setState({ hfMsg: 'Make an action roll in the Dice box first.' }); return; } upd({ hope: hope - 3 }); setTimeout(() => { const r = this._dice.doAction({ ...L0.opts, adv: (L0.opts.adv || 0) + 1, exp: '', label: 'Patron’s Boon reroll (with advantage)' }); this.setState({ hfMsg: name + ': rerolled with advantage. Total ' + (r ? r.total : '') + '.', hfPick: null }); }, 0); return; }
        if (id === 'Witch') { const v = this._dice.addGmFear(1); spend(null, name + ': the failed roll becomes a success with Fear. The GM gains a Fear (now ' + v + ').'); return; }
        if (id === 'Druid') {""")
R("Sorcerer: 'Reroll any number of your damage dice on this magic attack.', ","")
R("Warlock: 'Reroll the failed roll with advantage.', Witch: 'The failed action roll becomes a success with Fear. The GM gains a Fear.' };","};")
R("      advPick: advPickUi, hf: hfUi,","      advPick: advPickUi, hf: hfUi, dice: diceUi,")
MARK='''<section class="sh-box" aria-label="Dice"><h3 class="sh-h">Dice <span class="sh-small" style="font-weight: 400">· GM Fear {{ dice.gmFear }}</span></h3>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px">
<label style="display: flex; flex-direction: column; gap: 3px"><span class="sh-lbl">Trait</span><select class="sh-in" value="{{ dice.trait }}" onChange="{{ dice.setTrait }}"><sc-for list="{{ dice.traits }}" as="o" hint-placeholder-count="7"><option value="{{ o.v }}">{{ o.label }}</option></sc-for></select></label>
<label style="display: flex; flex-direction: column; gap: 3px"><span class="sh-lbl">Experience</span><select class="sh-in" value="{{ dice.exp }}" onChange="{{ dice.setExp }}"><sc-for list="{{ dice.exps }}" as="o" hint-placeholder-count="2"><option value="{{ o.v }}">{{ o.label }}</option></sc-for></select></label>
<label style="display: flex; flex-direction: column; gap: 3px"><span class="sh-lbl">Other modifier</span><input class="sh-in" type="text" placeholder="+0" value="{{ dice.mod }}" onChange="{{ dice.setMod }}"></label>
<label style="display: flex; flex-direction: column; gap: 3px"><span class="sh-lbl">Difficulty (optional)</span><input class="sh-in" type="text" inputmode="numeric" placeholder="—" value="{{ dice.diff }}" onChange="{{ dice.setDiff }}"></label>
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">
<span style="display: inline-flex; align-items: center; gap: 4px"><button type="button" onClick="{{ dice.advDown }}" aria-label="More disadvantage" style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid #a68352; background: #fffaf0; cursor: pointer">−</button><span class="sh-small" style="min-width: 118px; text-align: center">{{ dice.advText }}</span><button type="button" onClick="{{ dice.advUp }}" aria-label="More advantage" style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid #a68352; background: #fffaf0; cursor: pointer">+</button></span>
<button type="button" onClick="{{ dice.roll }}" style="min-height: 42px; padding: 0 18px; border-radius: 999px; border: none; background: linear-gradient(90deg, #c9962e, #6b3fae); color: #fff; font-family: 'Cinzel', serif; font-size: 15px; font-weight: 700; cursor: pointer">🎲 Roll Hope &amp; Fear</button>
</div>
<sc-if value="{{ dice.hasNote }}" hint-placeholder-val="{{ false }}"><div role="alert" class="sh-small" style="color: #8e2b2b">{{ dice.note }}</div></sc-if>
<sc-if value="{{ dice.hasLast }}" hint-placeholder-val="{{ false }}"><div role="status" style="display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 12px; border-radius: 10px; background: #fbf5e6; border: 1px solid #cdb88f">
<span style="display: flex; gap: 8px"><span title="Hope die" style="{{ dice.hopeDie }}">{{ dice.lHope }}</span><span title="Fear die" style="{{ dice.fearDie }}">{{ dice.lFear }}</span></span>
<span style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 180px"><span style="{{ dice.lStyle }}">{{ dice.lOutcome }}</span><span style="font-size: 28px; font-family: 'Cinzel', serif; font-weight: 900">{{ dice.lTotal }}</span><span class="sh-small">{{ dice.lLabel }} {{ dice.lParts }}</span><span class="sh-small" style="font-style: italic">{{ dice.lLines }}</span></span>
</div></sc-if>
<div style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; padding-top: 6px; border-top: 1px dashed #cdb88f">
<label style="display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 140px"><span class="sh-lbl">Damage dice</span><input class="sh-in" type="text" placeholder="{{ dice.dmgPh }}" value="{{ dice.dmg }}" onChange="{{ dice.setDmg }}"></label>
<button type="button" onClick="{{ dice.toggleCrit }}" aria-pressed="{{ dice.critDmg }}" class="sh-small" style="min-height: 38px; padding: 0 10px; border-radius: 8px; border: 1px solid #a68352; background: #fffaf0; cursor: pointer">Critical (+max dice): {{ dice.critDmg }}</button>
<button type="button" onClick="{{ dice.rollDmg }}" style="min-height: 38px; padding: 0 14px; border-radius: 999px; border: none; background: #8e2b2b; color: #fff; font-family: 'Cinzel', serif; font-weight: 700; cursor: pointer">⚔ Roll damage</button>
</div>
<sc-if value="{{ dice.hasDmg }}" hint-placeholder-val="{{ false }}"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; background: #fbf5e6; border: 1px solid #cdb88f">
<sc-for list="{{ dice.dDice }}" as="dd" hint-placeholder-count="2"><button type="button" onClick="{{ dd.pick }}" aria-pressed="{{ dd.pressed }}" style="{{ dd.style }}">{{ dd.v }}</button></sc-for>
<span style="flex: 1; min-width: 120px"><span style="font-family: 'Cinzel', serif; font-size: 26px; font-weight: 900">{{ dice.dTotal }}</span> <span class="sh-small">damage · {{ dice.dExpr }}</span></span>
<sc-if value="{{ dice.rerollMode }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ dice.doReroll }}" disabled="{{ dice.noSel }}" style="min-height: 36px; padding: 0 12px; border-radius: 8px; border: none; background: #6b3fae; color: #fff; cursor: pointer; font-family: inherit">{{ dice.rerollLabel }}</button><button type="button" onClick="{{ dice.cancelReroll }}" style="min-height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid #a68352; background: transparent; cursor: pointer; font-family: inherit">Done</button></sc-if>
</div></sc-if>
<sc-if value="{{ dice.hasHist }}" hint-placeholder-val="{{ false }}"><div class="sh-small" style="display: flex; flex-direction: column; gap: 2px; color: #6a5236"><span class="sh-lbl">Earlier</span><sc-for list="{{ dice.hist }}" as="hh" hint-placeholder-count="2"><span>{{ hh.text }}</span></sc-for></div></sc-if>
</section>
'''
anchor='<textarea class="sh-ta" data-key="hopeFeat" defaultValue="{{ f.hopeFeat }}" onChange="{{ setField }}" style="min-height: 72px"></textarea></label>\n'
i=s.index(anchor); j=s.index('</section>',i)+len('</section>')
s=s[:j]+'\n'+MARK+s[j:]
open(f,'w').write(s); print('ok')
