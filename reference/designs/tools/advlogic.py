S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/Party.dc.html'; s=open(f).read()
def R(a,b,n=1):
    global s; assert s.count(a)==n,(s.count(a),a[:90]); s=s.replace(a,b)
# controlled inputs so automatic changes show
R('data-key="evasion" defaultValue="{{ f.evasion }}"','data-key="evasion" value="{{ f.evasion }}"')
R('data-key="{{ t.key }}" defaultValue="{{ t.val }}"','data-key="{{ t.key }}" value="{{ t.val }}"')
R('<input class="sh-in" type="text" placeholder="+2" data-key="{{ e.mk }}" defaultValue="{{ e.m }}"','<input class="sh-in" type="text" placeholder="+2" data-key="{{ e.mk }}" value="{{ e.m }}"')
# apply logic
R("    const boxes = (n, t, tier, oi, used, cap) => {",
r"""    // ---- level-up advancements change the sheet: HP slot, Stress slot, Evasion apply directly; traits / Experiences ask which two.
    const bumpMod = (v, d) => { const n = (parseInt(String(v == null || v === '' ? '0' : v).replace('+', ''), 10) || 0) + d; return (n >= 0 ? '+' : '') + n; };
    const traitEpoch = (() => { const L0 = parseInt(f.level, 10) || 1; return L0 >= 8 ? 3 : L0 >= 5 ? 2 : 1; })();
    const applyAdv = (oi, key, turnOn) => {
      if (!ch) return; const F = { ...ch.f }; const patch = {}; const ap = { ...(F.advApplied || {}) };
      if (oi === 0 || oi === 3) {
        if (turnOn) { this.setState({ advPick: { key, kind: oi === 0 ? 'traits' : 'exps', chosen: [] } }); return; }
        (F[key + '_p'] || []).forEach((p) => { if (oi === 0) { F[p] = bumpMod(F[p], -1); F['tm_' + p] = null; } else { F['exp' + p + 'm'] = bumpMod(F['exp' + p + 'm'], -1); } });
        F[key] = false; delete F[key + '_p']; upd({ f: F }); return;
      }
      F[key] = turnOn; const d = turnOn ? 1 : -1;
      if (oi === 1 || oi === 2 || oi === 5) { if (turnOn) ap[key] = true; else if (!ap[key]) { F.advApplied = ap; upd({ f: F }); return; } else delete ap[key]; F.advApplied = ap; }
      if (oi === 1) { patch.hpMax = Math.max(1, Math.min(12, (ch.hpMax || 0) + d)); patch.hp = Math.min(ch.hp || 0, patch.hpMax); }
      if (oi === 2) { patch.stressMax = Math.max(1, Math.min(12, (ch.stressMax || 6) + d)); patch.stress = Math.min(ch.stress || 0, patch.stressMax); }
      if (oi === 5) F.evasion = String((parseInt(F.evasion, 10) || 0) + d);
      upd({ ...patch, f: F });
    };
    // one-time catch-up for boxes ticked before this logic existed
    if (ch && !this._advSync) { const F0 = ch.f || {}; const ap0 = F0.advApplied || {}; let dh = 0, ds = 0, de = 0; const ap1 = { ...ap0 };
      Object.keys(F0).forEach((k) => { const m = /^adv_t(\d)_o(\d)_(\d)$/.exec(k); if (!m || !F0[k] || ap0[k]) return; const oi = +m[2]; if (oi === 1) dh++; else if (oi === 2) ds++; else if (oi === 5) de++; else return; ap1[k] = true; });
      if (dh || ds || de) { this._advSync = true; setTimeout(() => { this._advSync = false; upd({ hpMax: Math.min(12, (ch.hpMax || 0) + dh), stressMax: Math.min(12, (ch.stressMax || 6) + ds), f: { ...ch.f, advApplied: ap1, evasion: de ? String((parseInt(ch.f.evasion, 10) || 0) + de) : ch.f.evasion } }); }, 0); } }
    const advPickUi = (() => {
      const pk = st.advPick; if (!pk || !ch) return { on: false };
      const isT = pk.kind === 'traits'; const chosen = pk.chosen || [];
      const opts = isT ? [['agility', 'Agility'], ['strength', 'Strength'], ['finesse', 'Finesse'], ['instinct', 'Instinct'], ['presence', 'Presence'], ['knowledge', 'Knowledge']].map(([k, label]) => { const raw = f['tm_' + k]; const marked = raw === traitEpoch || (raw === true && traitEpoch === 1); return { id: k, label: label + ' ' + (f[k] || '+0'), disabled: marked, note: marked ? 'marked' : '' }; })
        : [1, 2, 3, 4, 5].filter((i) => (f['exp' + i] || '').trim()).map((i) => ({ id: String(i), label: f['exp' + i] + ' ' + (f['exp' + i + 'm'] || '+2'), disabled: false, note: '' }));
      return { on: true, title: isT ? 'Raise two character traits by +1' : 'Raise two Experiences by +1', sub: isT ? 'Pick two unmarked traits. They get +1 and are marked until the next tier.' : 'Pick two Experiences. Each gets a permanent +1.',
        empty: !opts.length, emptyText: 'You have no Experiences written down yet. Add them on the sheet first.',
        opts: opts.map((o) => { const on = chosen.includes(o.id); return { ...o, pressed: on ? 'true' : 'false', dis: o.disabled || (!on && chosen.length >= 2) ? true : null,
          style: 'min-height: 44px; padding: 0 14px; border-radius: 10px; cursor: ' + (o.disabled ? 'not-allowed' : 'pointer') + '; font-family: inherit; font-size: 15px; border: 1.5px solid ' + (on ? '#5b2b2b' : '#cdb88f') + '; background: ' + (on ? '#e3c98f' : o.disabled ? '#e6dcc6' : '#fffaf0') + '; color: ' + (o.disabled ? '#9a8a6a' : '#2a1f14') + ';',
          pick: () => { if (o.disabled) return; const c = on ? chosen.filter((x) => x !== o.id) : chosen.concat(o.id).slice(0, 2); this.setState({ advPick: { ...pk, chosen: c } }); } }; }),
        canOk: chosen.length === 2 ? null : true, okLabel: chosen.length === 2 ? 'Apply +1 to both' : 'Pick ' + (2 - chosen.length) + ' more',
        ok: () => { if (chosen.length !== 2) return; const F = { ...ch.f }; chosen.forEach((p) => { if (isT) { F[p] = bumpMod(F[p], 1); F['tm_' + p] = traitEpoch; } else F['exp' + p + 'm'] = bumpMod(F['exp' + p + 'm'] || '+2', 1); }); F[pk.key] = true; F[pk.key + '_p'] = chosen; upd({ f: F }); this.setState({ advPick: null }); },
        cancel: () => this.setState({ advPick: null }) };
    })();
    const boxes = (n, t, tier, oi, used, cap) => {""")
R("toggle: () => { if (!ch || blocked) return; upd({ f: { ...ch.f, [key]: !on } }); } }; }); };",
  "toggle: () => { if (!ch || blocked) return; applyAdv(oi, key, !on); } }; }); };")
# expose advPickUi in return: find the place 'tiers' is returned
import re
m=re.search(r"\n      tiers,|\btiers, ", s)
assert m, 'tiers return'
i=m.start()
s=s[:i]+"\n      advPick: advPickUi,"+s[i:]
# modal markup before </main>... place at end of the x-dc root: before last '</x-dc>'
MODAL='''<sc-if value="{{ advPick.on }}" hint-placeholder-val="{{ false }}"><div style="position: fixed; inset: 0; z-index: 60; background: rgba(4, 8, 10, 0.72); display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box"><div role="dialog" aria-modal="true" aria-labelledby="advpick-t" style="max-width: 560px; width: 100%; background: #efe3c8; color: #2a1f14; border-radius: 14px; padding: 24px 26px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; font-family: 'EB Garamond', serif; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6)">
<h2 id="advpick-t" style="margin: 0; font-family: 'Cinzel', serif; font-size: 22px">{{ advPick.title }}</h2>
<p style="margin: 0; font-size: 17px; color: #4a3a26">{{ advPick.sub }}</p>
<sc-if value="{{ advPick.empty }}" hint-placeholder-val="{{ false }}"><p style="margin: 0; font-size: 16px; color: #8e2b2b">{{ advPick.emptyText }}</p></sc-if>
<div style="display: flex; flex-wrap: wrap; gap: 8px"><sc-for list="{{ advPick.opts }}" as="o" hint-placeholder-count="6"><button type="button" onClick="{{ o.pick }}" aria-pressed="{{ o.pressed }}" disabled="{{ o.dis }}" style="{{ o.style }}">{{ o.label }}<sc-if value="{{ o.note }}" hint-placeholder-val="{{ false }}"><span style="font-size: 12px; margin-left: 6px">({{ o.note }})</span></sc-if></button></sc-for></div>
<div style="display: flex; justify-content: flex-end; gap: 10px"><button type="button" onClick="{{ advPick.cancel }}" style="min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid #a68352; background: transparent; color: #4a3a26; font-family: inherit; font-size: 16px; cursor: pointer">Cancel</button><button type="button" onClick="{{ advPick.ok }}" disabled="{{ advPick.canOk }}" style="min-height: 44px; padding: 0 18px; border-radius: 10px; border: none; background: #3d5e2e; color: #f3ead6; font-family: 'Cinzel', serif; font-size: 15px; font-weight: 700; cursor: pointer">{{ advPick.okLabel }}</button></div>
</div></div></sc-if>
'''
j=s.rindex('</x-dc>'); k=s.rindex('</div>',0,j)
s=s[:k]+MODAL+s[k:]
open(f,'w').write(s); print('ok')
