S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/World.dc.html'; s=open(f).read()
def R(a,b):
    global s; assert s.count(a)==1,(s.count(a),a[:90]); s=s.replace(a,b)

# ---------- CSS
R('</style>','''.mseg{min-height:34px;padding:0 12px;border-radius:8px;border:1px solid #33444a;background:transparent;color:#e6ecea;font-size:13px;cursor:pointer;font-family:inherit}
.mseg[aria-pressed="true"]{background:#e3b45a;border-color:#e3b45a;color:#1a1408;font-weight:700}
.mchip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#0d1417;border:1px solid #2a3a40;font-size:12px;color:#d6dfdc;white-space:nowrap}
.mchip i{width:10px;height:10px;border-radius:50%;display:inline-block}
.m-free{position:absolute;inset:0;z-index:9;cursor:crosshair;touch-action:none}
</style>''')

# ---------- panel (after painting toolbar)
PANEL='''<sc-if value="{{ mOn }}" hint-placeholder-val="{{ false }}"><div role="region" aria-label="Measure and plan a route" style="display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: 12px; background: #141e22; border: 1px solid #e3b45a">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">
<span style="font-family: 'Cinzel', serif; font-size: 14px; font-weight: 700; color: #f3cf86; margin-right: 4px">Route</span>
<sc-for list="{{ mModes }}" as="m" hint-placeholder-count="3"><button type="button" class="mseg" aria-pressed="{{ m.pressed }}" onClick="{{ m.pick }}" title="{{ m.tip }}">{{ m.label }}</button></sc-for>
<span style="width: 1px; height: 24px; background: #2a3a40; margin: 0 4px"></span>
<label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9fb2b6">Travel<select class="fld" onChange="{{ mSetMethod }}" value="{{ mMethod }}" aria-label="Travel method" style="min-height: 34px; padding: 2px 8px; width: auto"><sc-for list="{{ mMethods }}" as="o" hint-placeholder-count="5"><option value="{{ o.v }}">{{ o.label }}</option></sc-for></select></label>
<label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9fb2b6">Pace<select class="fld" onChange="{{ mSetPace }}" value="{{ mPace }}" aria-label="Travel pace" style="min-height: 34px; padding: 2px 8px; width: auto"><option value="slow">Cautious ×0.75</option><option value="normal">Normal</option><option value="fast">Forced march ×1.33</option></select></label>
<label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9fb2b6">Hours/day<input class="fld" type="number" min="1" max="16" value="{{ mHours }}" onChange="{{ mSetHours }}" aria-label="Travel hours per day" style="width: 64px; min-height: 34px; padding: 2px 8px"></label>
<button type="button" class="mseg" onClick="{{ mToggleUnits }}" aria-label="Switch units">{{ mUnitsLabel }}</button>
<span style="flex: 1"></span>
<button type="button" class="mseg" onClick="{{ mUndo }}" disabled="{{ mNoPts }}">Undo point</button>
<button type="button" class="mseg" onClick="{{ mClear }}" disabled="{{ mNoPts }}">Clear</button>
<button type="button" class="mseg" onClick="{{ mMoveParty }}" disabled="{{ mNoRoute }}" title="Move the party token along this route">Move party along route</button>
<button type="button" class="zbtn" onClick="{{ toggleMeasure }}" style="width: auto; padding: 0 14px; font-size: 13px; height: 34px; background: #e3b45a; color: #1a1408; border-color: #e3b45a; font-weight: 700">Done</button>
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px">
<span role="status" style="font-family: 'Cinzel', serif; font-size: 18px; font-weight: 700; color: #f4efe6">{{ mSum.total }}</span>
<span style="font-size: 13px; color: #9fb2b6">{{ mSum.sub }}</span>
<sc-for list="{{ mSum.parts }}" as="p" hint-placeholder-count="3"><span class="mchip"><i style="background: {{ p.c }}"></i>{{ p.label }}</span></sc-for>
<sc-if value="{{ mSum.warn }}" hint-placeholder-val="{{ false }}"><span style="font-size: 12px; color: #f0a37a">{{ mSum.warnText }}</span></sc-if>
</div>
</div></sc-if>
'''
R('<sc-if value="{{ showLegend }}"', PANEL+'<sc-if value="{{ showLegend }}"')

# ---------- overlay replace
a=s.index('<sc-if value="{{ mLine.on }}"'); b=s.index('</sc-if>',a)+len('</sc-if>')
OV='''<sc-if value="{{ mPath.on }}" hint-placeholder-val="{{ false }}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" style="position: absolute; inset: 0; pointer-events: none; z-index: 7"><polyline points="{{ mPath.all }}" fill="none" stroke="rgba(20, 14, 8, 0.85)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline><sc-for list="{{ mPath.runs }}" as="r" hint-placeholder-count="2"><polyline points="{{ r.pts }}" fill="none" stroke="{{ r.c }}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline></sc-for></svg><sc-for list="{{ mPath.dots }}" as="d" hint-placeholder-count="2"><span aria-hidden="true" style="{{ d }}"></span></sc-for><span role="status" style="{{ mPath.labelStyle }}">{{ mPath.label }}</span></sc-if>
<sc-if value="{{ mFree }}" hint-placeholder-val="{{ false }}"><div class="m-free" aria-label="Draw a route on the map" onPointerDown="{{ mDown }}" onPointerMove="{{ mMove }}" onPointerUp="{{ mUp }}"></div></sc-if>'''
s=s[:a]+OV+s[b:]

# ---------- JS
R("    const measuring = !!st.measuring; const mp = st.mpts || [];","""    const measuring = !!st.measuring; const mp = st.mpts || [];
    const mmode = st.mmode || 'way';
    const mo = { method: 'foot', pace: 'normal', hours: 8, units: 'km', ...(data.mopts || {}) };""")
R("const PMAP = { foot: { r: 60, w: 40, h: 20, '.': 20 }, mount: { r: 80, w: 60, h: 30, '.': 20 } };",
  "const PMAP = { foot: { r: 60, w: 40, h: 20, '.': 20 }, mount: { r: 80, w: 60, h: 30, '.': 20 } };\n    const MSPD = { foot: { r: 60, w: 40, h: 20, '.': 8 }, mount: { r: 80, w: 60, h: 30, '.': 8 }, wagon: { r: 50, w: 30, h: 12, '.': 5 }, boat: { r: 30, w: 25, h: 15, '.': 100 }, fly: { r: 120, w: 120, h: 120, '.': 120 } };\n    const TCOL = { r: '#e0a93a', w: '#47a55a', h: '#d0453a', '.': '#3f86e0' }; const TNAME = { r: 'Road', w: 'Wilds', h: 'Hard going', '.': 'Water' };")
JS='''    // ---- route measuring (straight / waypoints / freehand), coloured by terrain
    const mUnit = mo.units === 'mi' ? 0.621371 : 1; const mUL = mo.units === 'mi' ? 'mi' : 'km';
    const mPaceK = mo.pace === 'slow' ? 0.75 : mo.pace === 'fast' ? 1.33 : 1;
    const mHrs = Math.max(1, Math.min(16, Number(mo.hours) || 8));
    const mFmtT = (days) => { const hrs = days * mHrs; if (hrs < 1) return Math.max(1, Math.round(hrs * 60)) + ' min'; if (days < 1) return (hrs < 3 ? hrs.toFixed(1) : Math.round(hrs)) + ' hrs'; const d = Math.floor(days); const h = Math.round((days - d) * mHrs); return d + (d === 1 ? ' day' : ' days') + (h ? ' ' + h + ' h' : ''); };
    const mFmtD = (km) => { const v = km * mUnit; return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ' + mUL; };
    const analyse = (pts) => {
      const runs = []; const per = { r: 0, w: 0, h: 0, '.': 0 }; let km = 0, days = 0; const spd = MSPD[mo.method] || MSPD.foot;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]; const seg = miles(a, b); const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.4));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, tm = (k + 0.5) / n;
          const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
          const ter = cellAt(a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm); const tk = per[ter] === undefined ? 'w' : ter;
          const d = seg / n; km += d; per[tk] += d; days += d / ((spd[tk] || 30) * mPaceK);
          const last = runs[runs.length - 1];
          if (last && last.t === tk) last.p.push(p1); else runs.push({ t: tk, p: [p0, p1] });
        }
      }
      return { runs, per, km, days };
    };
    const mRes = mp.length > 1 ? analyse(mp) : null;
    const mPath = (() => {
      if (!measuring || !mp.length) return { on: false };
      const P = (q) => q[0].toFixed(2) + ',' + q[1].toFixed(2);
      const dot = (q, end) => 'position: absolute; z-index: 8; left: ' + q[0] + '%; top: ' + q[1] + '%; width: ' + (end ? 14 : 10) + 'px; height: ' + (end ? 14 : 10) + 'px; margin: -' + (end ? 7 : 5) + 'px 0 0 -' + (end ? 7 : 5) + 'px; border-radius: 50%; background: ' + (end ? '#f4efe6' : '#1a1408') + '; border: 2px solid ' + (end ? '#1a1408' : '#f4efe6') + '; pointer-events: none; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);';
      const dots = mmode === 'free' ? [dot(mp[0], true)].concat(mp.length > 1 ? [dot(mp[mp.length - 1], true)] : []) : mp.map((q, i) => dot(q, i === 0 || i === mp.length - 1));
      const endp = mp[mp.length - 1];
      return { on: true, all: mp.map(P).join(' '), runs: mRes ? mRes.runs.map((r) => ({ c: TCOL[r.t] || '#47a55a', pts: r.p.map(P).join(' ') })) : [], dots,
        label: mRes ? mFmtD(mRes.km) + ' · ' + mFmtT(mRes.days) : (mmode === 'free' ? 'Drag to draw' : 'Click the next point'),
        labelStyle: 'position: absolute; z-index: 9; left: ' + endp[0] + '%; top: ' + endp[1] + '%; transform: translate(-50%, -170%); padding: 4px 9px; border-radius: 7px; background: #1a1408; color: #f4efe6; border: 1px solid #e3b45a; font-size: 12px; font-weight: 600; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5); pointer-events: none;' };
    })();
    const mSum = (() => {
      if (!mRes) return { total: mp.length ? 'Add another point…' : 'No route yet', sub: mmode === 'free' ? 'Press and drag on the map to draw a path.' : mmode === 'line' ? 'Click two points on the map.' : 'Click to drop waypoints; each click adds a leg.', parts: [], warn: false };
      const parts = Object.keys(mRes.per).filter((k) => mRes.per[k] > 0.05).map((k) => ({ c: TCOL[k], label: TNAME[k] + ' ' + mFmtD(mRes.per[k]) + ' · ' + Math.round(mRes.per[k] / mRes.km * 100) + '%' }));
      const water = mRes.per['.'] > 0.05;
      const warnText = mo.method === 'boat' ? (mRes.per.r + mRes.per.w + mRes.per.h > 0.05 ? 'Part of this route is overland, so the boat has to be carried (slow).' : '') : mo.method === 'fly' ? '' : (water ? 'This route crosses water: swimming or fording is very slow. Consider a boat.' : '');
      return { total: mFmtD(mRes.km) + ' · ' + mFmtT(mRes.days), sub: (mmode === 'line' ? 'Straight line' : (mp.length - 1) + (mp.length === 2 ? ' leg' : ' legs')) + ' · ' + mHrs + ' h travel per day', parts, warn: !!warnText, warnText };
    })();
    const setMo = (patch) => save({ ...cur(), mopts: { ...mo, ...patch } });
'''
R("    const tokens = visibleTokens.map((t) => {", JS+"    const tokens = visibleTokens.map((t) => {")

# return values
R("      toggleMeasure: () => this.setState({ measuring: !measuring, mpts: [], placing: null }),",
"""      toggleMeasure: () => this.setState({ measuring: !measuring, mpts: [], placing: null, painting: false }),
      mOn: measuring, mPath, mSum, mFree: measuring && mmode === 'free',
      mModes: [['line', 'Straight line', 'Distance between two points'], ['way', 'Waypoints', 'Click to add points along a route'], ['free', 'Freehand', 'Press and drag to draw a path']].map(([k, label, tip]) => ({ label, tip, pressed: mmode === k ? 'true' : 'false', pick: () => this.setState({ mmode: k, mpts: [] }) })),
      mMethods: [['foot', 'On foot'], ['mount', 'Mounted'], ['wagon', 'Wagon / cart'], ['boat', 'Boat'], ['fly', 'Flying']].map(([v, label]) => ({ v, label })),
      mMethod: mo.method, mPace: mo.pace, mHours: String(mHrs), mUnitsLabel: mo.units === 'mi' ? 'Miles' : 'Kilometres',
      mSetMethod: (e) => setMo({ method: e.target.value }), mSetPace: (e) => setMo({ pace: e.target.value }), mSetHours: (e) => setMo({ hours: Math.max(1, Math.min(16, Number(e.target.value) || 8)) }),
      mToggleUnits: () => setMo({ units: mo.units === 'mi' ? 'km' : 'mi' }),
      mNoPts: mp.length === 0, mNoRoute: mp.length < 2,
      mUndo: () => this.setState({ mpts: mmode === 'free' ? [] : mp.slice(0, -1) }), mClear: () => this.setState({ mpts: [] }),
      mMoveParty: () => { if (mp.length < 2) return; const c0 = cur(); const pp = c0.party || party; const step = Math.max(1, Math.floor(mp.length / 10)); const via = mp.filter((_, i) => i % step === 0).slice(0, -1); save({ ...c0, party: { ...pp, x: +mp[mp.length - 1][0].toFixed(2), y: +mp[mp.length - 1][1].toFixed(2), trail: (pp.trail || []).concat([[pp.x, pp.y]]).concat(via).slice(-24) } }, { mpts: [] }); },
      mDown: (e) => { e.stopPropagation(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} this._mdraw = [pct(e)]; this.setState({ mpts: this._mdraw }); },
      mMove: (e) => { if (!this._mdraw) return; const q = pct(e); const l = this._mdraw[this._mdraw.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) < 0.35) return; this._mdraw = this._mdraw.concat([q]); if (!this._mraf) { this._mraf = requestAnimationFrame(() => { this._mraf = null; this.setState({ mpts: this._mdraw }); }); } },
      mUp: () => { if (this._mdraw) { const pts = this._mdraw; this._mdraw = null; this.setState({ mpts: pts }); } },""")
# map click measure branch
R("if (measuring) { const q = pct(e); this.setState({ mpts: mp.length >= 2 ? [q] : mp.concat([q]) }); return; }",
  "if (measuring) { if (mmode === 'free') return; const q = pct(e); this.setState({ mpts: mmode === 'line' ? (mp.length >= 2 ? [q] : mp.concat([q])) : mp.concat([q]) }); return; }")
# hint
R("measuring ? (mp.length === 1 ? 'Click a second point to measure.' : 'Measuring: click two points on the map.')",
  "measuring ? (mmode === 'free' ? 'Freehand: press and drag on the map to draw a route.' : mmode === 'line' ? 'Click two points to measure. Drag to pan.' : 'Click to add waypoints. Drag to pan, scroll to zoom.')")
# remove old mLine block from return
a=s.index("      mLine: (() => {"); b=s.index("      ...(() => { const step = [1, 2, 5,",a)
s=s[:a]+s[b:]
# pan allowed while measuring in line/way mode
R("const st0 = this.state || {}; if (e.button === 0 && (st0.placing || st0.measuring || st0.painting)) return;",
  "const st0 = this.state || {}; if (e.button === 0 && (st0.placing || st0.painting || (st0.measuring && st0.mmode === 'free'))) return;")
R("t.closest('.tok, button, input, select, textarea, a, [aria-label=\"Paint terrain on the map\"]')","t.closest('.tok, button, input, select, textarea, a, .m-free, [aria-label=\"Paint terrain on the map\"]')")
open(f,'w').write(s); print('ok')
