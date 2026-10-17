S='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/'
f=S+'artifact-files/e3bfaa99-305b-4f55-bfd1-649821ac0b80/project/World.dc.html'; s=open(f).read()
def R(a,b):
    global s; assert s.count(a)==1,(s.count(a),a[:90]); s=s.replace(a,b)
R('<div style="position: relative; max-height: 900px; overflow: auto; border-radius: 14px;','<div id="wmap-vp" style="position: relative; max-height: 900px; overflow: auto; overscroll-behavior: contain; border-radius: 14px;')
R("'Drag tokens around the map. The gold banner is your party.'","'Scroll to zoom, drag the map to pan. Drag tokens to move them; the gold banner is your party.'")
R("cursor: ' + (placing ? 'crosshair' : 'default') + ';'","cursor: ' + (placing || measuring ? 'crosshair' : 'grab') + '; margin: 0 auto;'")
R("zoomIn: () => this.setState({ zoom: Math.min(3, +(zoom + 0.25).toFixed(2)) }), zoomOut: () => this.setState({ zoom: Math.max(1, +(zoom - 0.25).toFixed(2)) }), zoomFit: () => this.setState({ zoom: 1 }),",
  "zoomIn: () => this._zoomTo(zoom * 1.25), zoomOut: () => this._zoomTo(zoom / 1.25), zoomFit: () => { this._z = 1; this.setState({ zoom: 1 }); },")
R("mapClick: (e) => {","mapClick: (e) => { if (this._suppressClick) { this._suppressClick = false; return; }")
JS='''    // ---- pan (drag the map) & zoom (mouse wheel, anchored on the cursor)
    this._z = this._z ?? zoom;
    this._zoomTo = (nz, cx, cy) => {
      const vp = document.getElementById('wmap-vp'); const oz = this._z || 1;
      nz = Math.max(0.5, Math.min(6, nz)); if (Math.abs(nz - oz) < 0.001) return;
      let ax = 0, ay = 0, sx = 0, sy = 0;
      if (vp) { const r = vp.getBoundingClientRect(); ax = cx == null ? vp.clientWidth / 2 : cx - r.left; ay = cy == null ? vp.clientHeight / 2 : cy - r.top; sx = vp.scrollLeft; sy = vp.scrollTop; }
      this._z = nz; this.setState({ zoom: +nz.toFixed(3) });
      const k = nz / oz;
      const fix = () => { if (!vp) return; vp.scrollLeft = (sx + ax) * k - ax; vp.scrollTop = (sy + ay) * k - ay; };
      requestAnimationFrame(() => { fix(); requestAnimationFrame(fix); });
    };
    setTimeout(() => {
      const vp = document.getElementById('wmap-vp'); if (!vp || vp === this._vpEl) return; this._vpEl = vp;
      vp.addEventListener('wheel', (e) => { if (e.ctrlKey && Math.abs(e.deltaY) < 1) return; e.preventDefault(); const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; this._zoomTo((this._z || 1) * Math.exp(-d * 0.0015), e.clientX, e.clientY); }, { passive: false });
      vp.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        const t = e.target; if (t && t.closest && t.closest('.tok, button, input, select, textarea, a, [aria-label="Paint terrain on the map"]')) return;
        const st0 = this.state || {}; if (e.button === 0 && (st0.placing || st0.measuring || st0.painting)) return;
        this._pan = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop, moved: false, id: e.pointerId };
        if (e.button === 1) e.preventDefault();
      });
      window.addEventListener('pointermove', (e) => {
        const p = this._pan; if (!p || e.pointerId !== p.id) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (!p.moved && Math.hypot(dx, dy) < 4) return;
        if (!p.moved) { p.moved = true; vp.style.cursor = 'grabbing'; const m = vp.querySelector('[data-map]'); if (m) m.style.cursor = 'grabbing'; }
        vp.scrollLeft = p.sl - dx; vp.scrollTop = p.st - dy;
      });
      const end = (e) => { const p = this._pan; if (!p || (e && e.pointerId !== p.id)) return; this._pan = null; vp.style.cursor = ''; const m = vp.querySelector('[data-map]'); if (m) m.style.cursor = 'grab'; if (p.moved) { this._suppressClick = true; setTimeout(() => { this._suppressClick = false; }, 0); } };
      window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    }, 0);
'''
R("    const tokens = visibleTokens.map((t) => {", JS+"    const tokens = visibleTokens.map((t) => {")
open(f,'w').write(s); print('ok')
