S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/CampaignHub.dc.html'; s=open(f).read()
def R(a,b):
    global s; assert s.count(a)==1,(s.count(a),a[:90]); s=s.replace(a,b)
HELPER=r'''const VINE = (() => {
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const f1 = (n) => n.toFixed(1);
  // one gnarled stem: centre line from p0 heading along dir, wandering with layered noise
  const stem = (r, x0, y0, ang, len, wid, reach, bounds) => {
    const N = 48, pts = []; let x = x0, y = y0, a = ang; const ph = [r() * 6, r() * 6, r() * 6]; const step = len / N;
    for (let i = 0; i <= N; i++) { pts.push([x, y]); const s = i / N; a += (Math.sin(s * 9 + ph[0]) * 0.09 + Math.sin(s * 23 + ph[1]) * 0.05 + (r() - 0.5) * 0.12); if (bounds) { if (y < bounds[1] + 4) a += 0.08 * Math.sign(Math.cos(a)); if (y > bounds[3] - 4) a -= 0.08 * Math.sign(Math.cos(a)); } x += Math.cos(a) * step; y += Math.sin(a) * step; }
    const n = Math.max(0, Math.min(N, Math.round(N * reach))); if (n < 2) return null;
    const P = pts.slice(0, n + 1); const L = [], Rr = []; const nrm = [];
    for (let i = 0; i < P.length; i++) { const a0 = P[Math.max(0, i - 1)], a1 = P[Math.min(P.length - 1, i + 1)]; const dx = a1[0] - a0[0], dy = a1[1] - a0[1]; const d = Math.hypot(dx, dy) || 1; const nx = -dy / d, ny = dx / d; const s = i / P.length; const ww = (wid * Math.pow(1 - s, 0.6) + 0.5) * (0.85 + 0.3 * Math.sin(i * 1.7 + ph[2])); nrm.push([nx, ny, dx / d, dy / d, ww]); L.push([P[i][0] + nx * ww / 2, P[i][1] + ny * ww / 2]); Rr.push([P[i][0] - nx * ww / 2, P[i][1] - ny * ww / 2]); }
    const body = 'M ' + L.map((q) => f1(q[0]) + ' ' + f1(q[1])).join(' L ') + ' L ' + Rr.reverse().map((q) => f1(q[0]) + ' ' + f1(q[1])).join(' L ') + ' Z';
    return { P, nrm, body };
  };
  const build = (cfg) => {
    const r = rng(cfg.seed); let body = '', thorns = '', curls = '', veins = '';
    cfg.stems.forEach((st) => {
      const sm = stem(r, st[0], st[1], st[2], st[3], st[4], st[5], cfg.bounds); if (!sm) return; body += sm.body + ' ';
      veins += 'M ' + sm.P.filter((_, i) => i % 2 === 0).map((q) => f1(q[0]) + ' ' + f1(q[1])).join(' L ') + ' ';
      for (let i = 2; i < sm.P.length - 1; i += 1 + Math.floor(r() * 2)) {
        const [nx, ny, tx, ty, ww] = sm.nrm[i]; const side = r() < 0.5 ? 1 : -1; const len = (cfg.thorn * (0.6 + r() * 0.9)) * (1 - i / sm.P.length * 0.5);
        const bx = sm.P[i][0] + nx * side * ww * 0.45, by = sm.P[i][1] + ny * side * ww * 0.45; const bw = Math.max(0.8, ww * 0.35);
        const tipx = bx + nx * side * len - tx * len * 0.55, tipy = by + ny * side * len - ty * len * 0.55;
        thorns += 'M ' + f1(bx - tx * bw) + ' ' + f1(by - ty * bw) + ' Q ' + f1(bx + nx * side * len * 0.35) + ' ' + f1(by + ny * side * len * 0.35) + ' ' + f1(tipx) + ' ' + f1(tipy) + ' L ' + f1(bx + tx * bw) + ' ' + f1(by + ty * bw) + ' Z ';
        if (r() < cfg.curl) { const cl = len * 2.2; const ex = bx + nx * side * cl + tx * cl * 0.4, ey = by + ny * side * cl + ty * cl * 0.4; curls += 'M ' + f1(bx) + ' ' + f1(by) + ' C ' + f1(bx + nx * side * cl * 0.9) + ' ' + f1(by + ny * side * cl * 0.9) + ' ' + f1(ex + tx * cl * 0.6) + ' ' + f1(ey + ty * cl * 0.6) + ' ' + f1(ex) + ' ' + f1(ey) + ' q ' + f1(-tx * 2 - nx * side * 2) + ' ' + f1(-ty * 2 - ny * side * 2) + ' ' + f1(-nx * side * 3) + ' ' + f1(-ny * side * 3) + ' '; }
      }
    });
    return { body: body || 'M 0 0', thorns: thorns || 'M 0 0', curls: curls || 'M 0 0', veins: veins || 'M 0 0' };
  };
  return { build };
})();
'''
R("class Component extends DCLogic {", HELPER+"class Component extends DCLogic {")
# strip markup
a=s.index('<svg viewBox="0 0 240 44"'); b=s.index('</sc-for>',s.index('<sc-for list="{{ pc.leaves }}"'))+len('</sc-for>')
s=s[:a]+'''<svg viewBox="0 0 240 44" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" style="position: absolute; inset: 0; overflow: visible"><defs><filter id="vglow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.4"></feGaussianBlur></filter></defs><path d="{{ pc.vn.veins }}" fill="none" stroke="#8b3fe0" stroke-width="2.4" stroke-linecap="round" filter="url(#vglow)" opacity="{{ pc.vn.glow }}"></path><path d="{{ pc.vn.curls }}" fill="none" stroke="#0a0d07" stroke-width="1.1" stroke-linecap="round"></path><path d="{{ pc.vn.body }}" fill="#0c1108" stroke="#25301a" stroke-width="0.5" stroke-linejoin="round"></path><path d="{{ pc.vn.thorns }}" fill="#050604" stroke="#3a2f22" stroke-width="0.35" stroke-linejoin="round"></path><path d="{{ pc.vn.veins }}" fill="none" stroke="#b67cff" stroke-width="0.45" stroke-dasharray="3 5" opacity="{{ pc.vn.glow }}"></path></svg>'''+s[b:]
# creep markup
a=s.index('<svg viewBox="0 0 300 160" preserveAspectRatio="none"'); b=s.index('</sc-for>',s.index('<sc-for list="{{ pc.creep.leaves }}"'))+len('</sc-for>')
s=s[:a]+'''<svg viewBox="0 0 300 160" preserveAspectRatio="none" width="100%" height="100%" style="position: absolute; inset: 0"><path d="{{ pc.creep.v.veins }}" fill="none" stroke="#8b3fe0" stroke-width="3" stroke-linecap="round" filter="url(#vglow)" opacity="{{ pc.creep.glow }}"></path><path d="{{ pc.creep.v.curls }}" fill="none" stroke="#080b06" stroke-width="1.4" stroke-linecap="round"></path><path d="{{ pc.creep.v.body }}" fill="#0b1007" stroke="#26311a" stroke-width="0.6" stroke-linejoin="round"></path><path d="{{ pc.creep.v.thorns }}" fill="#040503" stroke="#3a2f22" stroke-width="0.4" stroke-linejoin="round"></path></svg>'''+s[b:]
# logic: add vn + creep.v
R("          const creep = { on: t2 > 0, leaves: creepLeaves,","          const creep = { on: t2 > 0, leaves: creepLeaves, glow: (0.25 + 0.6 * t2).toFixed(2),\n            v: VINE.build({ seed: 977 + i * 31, thorn: 6, curl: 0.35, bounds: [0, 0, 300, 160], stems: [[4, 162, -1.35, 190, 9, Math.min(1, t2 * 1.6)], [150, 162, -1.75, 170, 8, Math.max(0, Math.min(1, (t2 - 0.2) * 1.6))], [298, 162, -1.9, 190, 9, Math.min(1, t2 * 1.3)], [-2, 138, -0.12, 320, 6, Math.max(0, (t2 - 0.45) * 2)], [302, 100, 3.3, 200, 5, Math.max(0, (t2 - 0.7) * 3)]] }),")
R("          return { creep, stem1: mkPath(f1),","          const vn = VINE.build({ seed: 101 + i * 17, thorn: 4.2, curl: 0.25, bounds: [0, 2, 240, 42], stems: [[-2, 24, 0.05, 250, 5.5, Math.min(1, w / 10)], [242, 18, 3.1, 250, 4.5, Math.max(0, (w - 10) / 10)], [-2, 34, -0.1, 250, 3, Math.max(0, Math.min(1, (w - 3) / 12))]] });\n          vn.glow = (0.15 + 0.75 * t).toFixed(2);\n          return { vn, creep, stem1: mkPath(f1),")
open(f,'w').write(s); print('ok')
