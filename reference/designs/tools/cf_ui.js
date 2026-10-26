    // ---- class features: interactive pieces of each class's features (Hope feature lives in the Hope box)
    const cfUi = (() => {
      if (!ch) return { on: false, rows: [] };
      const id = cls.id; const CF = ch.cf || {}; const lv = Math.min(10, Math.max(1, parseInt(ch.f.level, 10) || 1)); const tr = tierOfL(lv);
      const scName = (SUB_CARDS[ch.f.subclass] || {}).sc || ''; const scKey = scName.toLowerCase(); const scVal = scKey ? modN(ch.f[scKey]) : 0;
      const hope = ch.hope || 0; const stress = ch.stress || 0; const sMax = ch.stressMax || 6;
      const setCF = (p, msg, extra) => { upd({ ...(extra || {}), cf: { ...CF, ...p } }); if (msg != null) this.setState({ cfMsg: msg }); };
      const say = (m) => this.setState({ cfMsg: m });
      // marking Stress when all Stress is marked marks a Hit Point instead
      const markStress = (n) => { const free = Math.max(0, sMax - stress); const s = Math.min(n, free); return { stress: stress + s, hp: Math.min(ch.hpMax || 0, (ch.hp || 0) + (n - s)) }; };
      const DSn = () => (this.state.dice || {});
      const bumpLast = (n, why) => { const L = DSn().last; if (!L) return false; const total = L.total + n; setDS({ last: { ...L, total, success: L.diff ? (L.crit || total >= L.diff) : null, lines: L.lines.concat(why + ' +' + n + '.') } }); return true; };
      const bumpDmg = (n, why) => { const D = DSn().lastDmg; if (!D) return false; setDS({ lastDmg: { ...D, total: D.total + n, flat: D.flat + n, expr: D.expr + ' · ' + why + ' +' + n } }); return true; };
      const throwDice = (list) => { if (DICE3D.enabled()) DICE3D.roll(list, () => {}); };
      const inp = st.cfIn || {}; const setIn = (k) => (ev) => this.setState({ cfIn: { ...(this.state.cfIn || {}), [k]: ev.target.value } });
      const B = (label, act, o) => { o = o || {}; const dis = !!o.dis; const kind = o.pressed != null ? (o.pressed ? 'on' : 'off') : (o.kind || 'n');
        const bg = dis ? '#efe6d4' : kind === 'p' ? 'linear-gradient(90deg,#c9962e,#9a6b10)' : kind === 'r' ? '#8e2b2b' : kind === 'on' ? '#3f6b4f' : '#fffaf0';
        const col = dis ? '#a8977a' : (kind === 'p' || kind === 'r' || kind === 'on') ? '#fff' : '#2a1f14';
        return { label, act: dis ? () => {} : act, dis: dis ? true : null, pressed: o.pressed != null ? (o.pressed ? 'true' : 'false') : null,
          style: 'min-height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid ' + (kind === 'n' || kind === 'off' ? '#a68352' : 'transparent') + '; background: ' + bg + '; color: ' + col + '; cursor: ' + (dis ? 'not-allowed' : 'pointer') + '; font-family: inherit; font-size: 13px; font-weight: 600; white-space: nowrap;' }; };
      const R = (title, text, btns, o) => ({ title, text: text || '', btns: btns || [], hasBtns: !!(btns && btns.length), hasInput: !!(o && o.input), ph: o && o.ph || '', val: o && o.input ? (inp[o.input] || '') : '', setVal: o && o.input ? setIn(o.input) : () => {}, hasChips: !!(o && o.chips && o.chips.length), chips: (o && o.chips) || [] });
      const rows = [];
      // Rally Dice can sit on anyone's sheet
      if (CF.rally) rows.push(R('Rally Die · ' + CF.rally, 'Spend it to add to a roll or clear Stress. Unspent Rally Dice clear at the end of the session.', [
        B('Add to my last roll', () => { const s = parseInt(CF.rally.slice(1), 10); const v = d(s); throwDice([{ sides: s, value: v, theme: 'hope' }]); if (!bumpLast(v, 'Rally Die')) { say('Make an action roll first.'); return; } setCF({ rally: '' }, 'Rally Die: rolled ' + v + ', added to your last roll.'); }, { kind: 'p' }),
        B('Add to my last damage', () => { const s = parseInt(CF.rally.slice(1), 10); const v = d(s); throwDice([{ sides: s, value: v, theme: 'hope' }]); if (!bumpDmg(v, 'Rally Die')) { say('Roll damage first.'); return; } setCF({ rally: '' }, 'Rally Die: rolled ' + v + ', added to your damage.'); }),
        B('Clear Stress', () => { const s = parseInt(CF.rally.slice(1), 10); const v = d(s); throwDice([{ sides: s, value: v, theme: 'hope' }]); setCF({ rally: '' }, 'Rally Die: rolled ' + v + ', cleared ' + Math.min(v, stress) + ' Stress.', { stress: Math.max(0, stress - v) }); })]));
      if (id === 'Bard') { const die = lv >= 5 ? 'd8' : 'd6';
        rows.push(R('Rally', 'Once per session: give yourself and each ally a Rally Die (' + die + ').', [
          B(CF.rallyUsed ? 'Used this session' : '✦ Rally the party', () => { const next = chars.map((c, j) => (c.dead ? c : { ...c, cf: { ...(c.cf || {}), rally: die, ...(j === open ? { rallyUsed: true } : {}) } })); save(next, { cfMsg: 'Rally! Everyone in the party gains a ' + die + ' Rally Die.' }); }, { kind: 'p', dis: !!CF.rallyUsed }),
          B('End session', () => { const next = chars.map((c, j) => ({ ...c, cf: { ...(c.cf || {}), rally: '', ...(j === open ? { rallyUsed: false } : {}) } })); save(next, { cfMsg: 'Session ended: unspent Rally Dice cleared, Rally is ready again.' }); })])); }
      if (id === 'Druid') rows.push(R('Wildtouch', 'Harmless, subtle nature effects at will. No roll needed. Use the Beastform button above to transform.'));
      if (id === 'Guardian') { const U = CF.unst; const max = lv >= 5 ? 6 : 4;
        if (!U) rows.push(R('Unstoppable', 'Once per long rest. Your Unstoppable Die (d' + max + ') starts at 1 and is added to your damage rolls.', [B(CF.unstUsed ? 'Used until long rest' : '✦ Become Unstoppable', () => setCF({ unst: { v: 1, max }, unstUsed: true }, 'Unstoppable! Your die starts at 1. Physical damage is reduced by one threshold.'), { kind: 'p', dis: !!CF.unstUsed })]));
        else rows.push(R('Unstoppable · die at ' + U.v + ' / ' + U.max, 'Adds +' + U.v + ' to damage rolls automatically. Incoming physical damage drops one threshold. You can’t be Restrained or Vulnerable.', [
          B('Dealt HP → +1', () => { if (U.v + 1 > U.max) setCF({ unst: null }, 'The die would exceed ' + U.max + ': you drop out of Unstoppable.'); else setCF({ unst: { ...U, v: U.v + 1 } }, 'Unstoppable Die is now ' + (U.v + 1) + '.'); }, { kind: 'p' }),
          B('Incoming damage is magic', () => setDS({ magic: !DS.magic }), { pressed: !!DS.magic }),
          B('Scene ended', () => setCF({ unst: null }, 'You drop out of Unstoppable.'), { kind: 'r' })])); }
      if (id === 'Ranger') { const L = DS.last;
        if (CF.focus) rows.push(R('Focus: ' + CF.focus, 'You know their direction. When you damage them, they mark a Stress.', [
          B('End Focus & reroll Duality Dice', () => { const L0 = DSn().last; if (!L0) return; doAction({ ...L0.opts, exp: '', label: 'Focus reroll ·', cfSet: { focus: '' } }); say('Ranger’s Focus ended to reroll your Duality Dice.'); }, { kind: 'p', dis: !(L && L.success === false) }),
          B('End Focus', () => setCF({ focus: '' }, 'Ranger’s Focus ended.'), { kind: 'r' })]));
        rows.push(R('Ranger’s Focus', 'Spend a Hope and attack (uses the Dice box trait and Difficulty). On a success the target becomes your Focus.', [
          B('✦ Focus attack · 1 Hope', () => { const t = (inp.focus || '').trim() || 'Target'; if (hope < 1) { say('You need a Hope.'); return; } const r = doAction({ label: 'Ranger’s Focus vs ' + t + ' ·', hopeBase: hope - 1, cfIfSuccess: { focus: t } }); if (r) say(r.success === false ? 'The attack missed: no Focus.' : t + ' is now your Focus.'); this.setState({ cfIn: { ...(this.state.cfIn || {}), focus: '' } }); }, { kind: 'p', dis: hope < 1 })], { input: 'focus', ph: 'Target name' })); }
      if (id === 'Rogue') {
        rows.push(R('Cloaked', CF.cloaked ? 'You are Cloaked: unseen while stationary. Your next attack gets Sneak Attack, then you lose Cloaked.' : 'When you would be Hidden, you are Cloaked instead.', [B(CF.cloaked ? '✓ Cloaked' : 'Become Cloaked', () => setCF({ cloaked: !CF.cloaked }), { pressed: !!CF.cloaked })]));
        rows.push(R('Sneak Attack', '+' + tr + 'd6 damage when you are Cloaked or an ally is in Melee with the target. Added to your next damage roll.', [B(DS.sneak ? '✓ Ally in Melee with target' : 'Ally in Melee with target', () => setDS({ sneak: !DS.sneak }), { pressed: !!DS.sneak })])); }
      if (id === 'Seraph') { const PD = Array.isArray(CF.prayer) ? CF.prayer : []; const tgt = st.cfTgt ?? open;
        const others = chars.map((c, j) => ({ c, j })).filter(({ c }) => !c.dead);
        rows.push(R('Prayer Dice', 'Start of each session: roll ' + Math.max(0, scVal) + 'd4 (your ' + (scName || 'Spellcast') + '). Spend them to reduce damage, add to a roll, or give Hope.', [
          B('✦ Roll Prayer Dice', () => { const n = Math.max(0, scVal); if (!n) { say('Your Spellcast trait is +0 or lower, so you get no Prayer Dice.'); return; } const v = Array.from({ length: n }, () => d(4)); throwDice(v.map((x) => ({ sides: 4, value: x, theme: 'hope' }))); setCF({ prayer: v }, 'Prayer Dice: ' + v.join(', ') + '.'); }, { kind: 'p' }),
          B('End session', () => setCF({ prayer: [] }, 'Unspent Prayer Dice cleared.'))],
          { chips: PD.length ? others.map(({ c, j }) => B('Hope goes to ' + (j === open ? 'me' : (c.f.name || 'Hero')), () => this.setState({ cfTgt: j }), { pressed: tgt === j })) : [] }));
        PD.forEach((v, i) => { const rest = PD.filter((_, k) => k !== i);
          rows.push(R('Prayer Die · ' + v, '', [
            B('Gain ' + v + ' Hope', () => { const cap = (c) => 6 - (c.scars || 0); const next = chars.map((c, j) => { let x = c; if (j === tgt) x = { ...x, hope: Math.min(cap(x), (x.hope || 0) + v) }; if (j === open) x = { ...x, cf: { ...(x.cf || {}), prayer: rest } }; return x; }); save(next, { cfMsg: 'Prayer Die: ' + ((chars[tgt] && chars[tgt].f.name) || 'you') + ' gains ' + v + ' Hope.' }); }, { kind: 'p' }),
            B('Add ' + v + ' to last roll', () => { if (!bumpLast(v, 'Prayer Die')) { say('Make an action roll first.'); return; } setCF({ prayer: rest }, 'Prayer Die added to your last roll.'); }),
            B('Reduce incoming damage by ' + v, () => { const dIn = parseInt(this.state.dmgIn, 10) || 0; this.setState({ dmgIn: String(Math.max(0, dIn - v)) }); setCF({ prayer: rest }, 'Incoming damage reduced by ' + v + ' (see Take damage).'); })])); }); }
      if (id === 'Sorcerer') { const pick = st.cfPick === 'crp';
        const all = this.domainCards(); const loadIds = (Array.isArray(ch.f.loadout) ? ch.f.loadout : []);
        rows.push(R('Minor Illusion', 'Spellcast Roll (10)' + (scName ? ' using ' + scName + ' ' + (ch.f[scKey] || '+0') : '') + '.', [B('Roll Minor Illusion', () => doAction({ trait: scKey || 'none', diff: 10, exp: '', label: 'Minor Illusion ·' }), { kind: 'p' })]));
        rows.push(R('Channel Raw Power', CF.crpBonus ? 'Next damage roll gets +' + CF.crpBonus + '.' : 'Once per long rest: put a loadout card into your vault for Hope equal to its level, or +2× its level to a spell’s damage.', [B(CF.crpUsed ? 'Used until long rest' : pick ? 'Cancel' : '✦ Channel a card', () => this.setState({ cfPick: pick ? null : 'crp' }), { kind: pick ? 'n' : 'p', dis: !!CF.crpUsed })]));
        if (pick) loadIds.forEach((cid) => { const c = all.find((x) => x.id === cid); if (!c) return; const toVault = { ...ch.f, loadout: loadIds.filter((x) => x !== cid) };
          rows.push(R(c.name + ' · level ' + c.lvl, '', [
            B('Gain ' + c.lvl + ' Hope', () => { upd({ hope: Math.min(6 - (ch.scars || 0), hope + c.lvl), f: toVault, cf: { ...CF, crpUsed: true } }); this.setState({ cfPick: null, cfMsg: c.name + ' moved to your vault: +' + c.lvl + ' Hope.' }); }, { kind: 'p' }),
            B('+' + (2 * c.lvl) + ' to next spell damage', () => { upd({ f: toVault, cf: { ...CF, crpUsed: true, crpBonus: 2 * c.lvl } }); this.setState({ cfPick: null, cfMsg: c.name + ' moved to your vault: your next damage roll gets +' + (2 * c.lvl) + '.' }); })])); });
        if (pick && !loadIds.length) rows.push(R('Your loadout is empty', 'Add domain cards to your loadout first.')); }
      if (id === 'Warrior') {
        rows.push(R('Combat Training', 'Physical damage gets +' + lv + ' (your level), added to damage rolls.', [B(DS.phys !== false ? '✓ Dealing physical damage' : 'Dealing magic damage', () => setDS({ phys: DS.phys === false }), { pressed: DS.phys !== false })]));
        rows.push(R('Attack of Opportunity', 'When an adversary in Melee tries to leave: reaction roll with the Dice box trait vs their Difficulty. Success: choose one (two on a crit): they can’t move · deal primary weapon damage · move with them.', [B('Reaction roll', () => doAction({ reaction: true, exp: '', label: 'Attack of Opportunity (reaction) ·' }), { kind: 'p' })])); }
      if (id === 'Wizard') {
        rows.push(R('Strange Patterns' + (CF.sp ? ' · ' + CF.sp : ''), 'When either Duality Die shows your number, gain a Hope or clear a Stress. You can change it on a long rest.', [], { chips: Array.from({ length: 12 }, (_, k) => B(String(k + 1), () => setCF({ sp: k + 1 }), { pressed: CF.sp === k + 1 })) }));
        if (st.cfSP) rows.push(R('Your number came up!', '', [
          B('Gain a Hope', () => { upd({ hope: Math.min(6 - (ch.scars || 0), hope + 1) }); this.setState({ cfSP: false, cfMsg: 'Strange Patterns: +1 Hope.' }); }, { kind: 'p' }),
          B('Clear a Stress', () => { upd({ stress: Math.max(0, stress - 1) }); this.setState({ cfSP: false, cfMsg: 'Strange Patterns: cleared a Stress.' }); })])); }
      if (id === 'Assassin') {
        rows.push(R(CF.mfd ? 'Marked for Death: ' + CF.mfd : 'Marked for Death', CF.mfd ? '+' + tr + 'd4 damage against them. Ends on a rest, when they’re defeated, or if the GM spends ' + tr + ' Fear.' : 'After a successful weapon attack, mark a Stress to mark the target. One target at a time.',
          CF.mfd ? [B(DS.mfd !== false ? '✓ Attacking the marked target' : 'Attacking someone else', () => setDS({ mfd: DS.mfd === false }), { pressed: DS.mfd !== false }), B('Clear mark', () => setCF({ mfd: '' }, 'Mark cleared.'), { kind: 'r' })]
            : [B('Mark (1 Stress)', () => { const t = (inp.mfd || '').trim() || 'Target'; upd({ ...markStress(1), cf: { ...CF, mfd: t } }); this.setState({ cfMsg: t + ' is Marked for Death.', cfIn: { ...(this.state.cfIn || {}), mfd: '' } }); }, { kind: 'p' })], CF.mfd ? null : { input: 'mfd', ph: 'Target name' }));
        rows.push(R('Get In & Get Out', CF.gig ? 'Your next action roll has advantage (applied automatically).' : 'Spend a Hope to ask the GM for a quick way in or out. Your next roll on it has advantage.', [B(CF.gig ? '✓ Advantage ready' : 'Use · 1 Hope', () => { if (CF.gig) return; upd({ hope: hope - 1, cf: { ...CF, gig: true } }); say('Ask the GM for the way in or out. Your next action roll gets advantage.'); }, { kind: 'p', dis: !CF.gig && hope < 1 })])); }
      if (id === 'Brawler') { const cd = CF.combo || 4; const steps = [4, 6, 8, 10, 12];
        rows.push(R('I Am the Weapon', CF.strike ? 'Brawler’s Strike active: ' + profOf(ch) + 'd8+' + profOf(ch) + 'd6 physical (leave Damage blank to use it). +1 Evasion.' : 'With no other Active Weapons, Brawler’s Strike deals d8+d6 per Proficiency and gives +1 Evasion.', [B(CF.strike ? '✓ Brawler’s Strike' : 'Use Brawler’s Strike', () => upd({ cf: { ...CF, strike: !CF.strike }, f: { ...ch.f, evasion: String((parseInt(ch.f.evasion, 10) || 0) + (CF.strike ? -1 : 1)) } }), { pressed: !!CF.strike })]));
        rows.push(R('Combo Strike · d' + cd, 'After a successful Melee damage roll, mark a Stress: roll your Combo Die until a roll is lower than the one before, and add them all.', [
          B('✦ Combo (1 Stress)', () => { const D0 = DSn().lastDmg; if (!D0) { say('Roll damage first.'); return; } const seq = [d(cd)]; while (seq.length < 30) { const nx = d(cd); seq.push(nx); if (nx < seq[seq.length - 2]) break; } const sum = seq.reduce((a, b) => a + b, 0);
            throwDice(seq.map((v) => ({ sides: cd, value: v, theme: 'dis' }))); upd(markStress(1)); bumpDmg(sum, 'Combo ' + seq.join('→')); say('Combo Strike: ' + seq.join(' → ') + ' = +' + sum + ' damage.'); }, { kind: 'p' }),
          B('Bigger Combo Die', () => { const i = steps.indexOf(cd); if (i < steps.length - 1) setCF({ combo: steps[i + 1] }); }, { dis: cd >= 12 }), B('Smaller', () => { const i = steps.indexOf(cd); if (i > 0) setCF({ combo: steps[i - 1] }); }, { dis: cd <= 4 })])); }
      if (id === 'Warlock') { const fav = CF.favor ?? 3; const pd = lv >= 5 ? 8 : 6; const L = DS.last;
        rows.push(R('Favor · ' + fav, 'Spend a Favor before an action roll in your patron’s sphere to add your Patron Die (d' + pd + ').' + (CF.patron ? ' Patron: ' + CF.patron + (CF.sphere ? ' (' + CF.sphere + ')' : '') + '.' : ''), [
          B(DS.patron ? '✓ Patron Die on next roll' : 'Call on patron (next roll)', () => setDS({ patron: !DS.patron }), { pressed: !!DS.patron, dis: !DS.patron && fav < 1 }),
          B('Tribute (+' + Math.max(0, scVal) + ' Favor)', () => setCF({ favor: fav + Math.max(0, scVal) }, 'You show tribute to your patron: +' + Math.max(0, scVal) + ' Favor.')),
          B('Favor instead of Hope', () => { const L0 = DSn().last; upd({ hope: Math.max(0, hope - 1), cf: { ...CF, favor: fav + 1 } }); setDS({ last: { ...L0, swapped: true, lines: L0.lines.concat('Took a Favor instead of the Hope.') } }); say('+1 Favor instead of the Hope.'); }, { dis: !(L && L.withHope && L.success !== false && !L.swapped && !L.reaction) }),
          B('−', () => setCF({ favor: Math.max(0, fav - 1) })), B('+', () => setCF({ favor: fav + 1 }))]));
        rows.push(R('Patron’s Pact', CF.patron ? '' : 'Name your patron and their sphere of influence.', [B('Save', () => { const p = (inp.patron || '').trim(); if (!p) return; const [nm, sp] = p.split(/[,(]/); setCF({ patron: nm.trim(), sphere: (sp || '').replace(')', '').trim() }, 'Patron saved.'); this.setState({ cfIn: { ...(this.state.cfIn || {}), patron: '' } }); })], { input: 'patron', ph: 'Patron name, sphere (e.g. The Pale Queen, Death)' })); }
      if (id === 'Witch') { const H = Array.isArray(CF.hexes) ? CF.hexes : []; const maxH = Math.max(0, scVal);
        rows.push(R('Hex · ' + H.length + ' / ' + maxH, 'Mark a Stress to Hex a target in Far range: −' + tr + ' to their damage rolls and Difficulty.', [B('Hex (1 Stress)', () => { const t = (inp.hex || '').trim() || 'Target'; upd({ ...markStress(1), cf: { ...CF, hexes: H.concat(t) } }); this.setState({ cfMsg: t + ' is Hexed (−' + tr + ' damage and Difficulty).', cfIn: { ...(this.state.cfIn || {}), hex: '' } }); }, { kind: 'p', dis: H.length >= maxH })],
          { input: 'hex', ph: 'Target name', chips: H.map((t, i) => B('✕ ' + t, () => setCF({ hexes: H.filter((_, k) => k !== i) }, 'Hex on ' + t + ' ended.'))) }));
        const CH = { 1: 'a flavor, scent, or sensation', 2: 'a flavor, scent, or sensation', 3: 'a flavor, scent, or sensation', 4: 'sounds or a vision', 5: 'sounds or a vision', 6: 'a full psychic scene, as if you were there' };
        rows.push(R('Commune', 'Once per long rest in a moment of calm: ask a question and roll ' + Math.max(0, scVal) + 'd6. Pick one result.', [B(CF.communeUsed ? 'Used until long rest' : '✦ Commune', () => { const n = Math.max(0, scVal); if (!n) { say('Your Spellcast trait is +0 or lower, so you roll no dice.'); return; } const v = Array.from({ length: n }, () => d(6)); throwDice(v.map((x) => ({ sides: 6, value: x, theme: 'fear' }))); const best = Math.max(...v); setCF({ communeUsed: true }, 'Commune: rolled ' + v.join(', ') + '. Best pick ' + best + ': ' + CH[best] + '.'); }, { kind: 'p', dis: !!CF.communeUsed })])); }
      // rests reset per-rest uses
      const restP = (long) => ({ ...CF, mfd: '', gig: CF.gig, ...(long ? { unstUsed: false, crpUsed: false, communeUsed: false } : {}) });
      rows.push(R('Rest', 'Resets the class uses above that refresh on a rest.', [B('Short rest', () => setCF(restP(false), 'Short rest taken.')), B('Long rest', () => setCF(restP(true), 'Long rest taken: once-per-long-rest features are ready.'))]));
      return { on: true, rows, msg: st.cfMsg || '', hasMsg: !!st.cfMsg };
    })();
