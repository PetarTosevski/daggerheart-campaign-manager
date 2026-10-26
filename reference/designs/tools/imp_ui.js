    // ---- import a character by photographing a physical sheet: Claude reads the photo, the GM reviews, then it's created
    const impUi = (() => {
      const I = st.imp || {}; const setI = (p) => this.setState({ imp: { ...(this.state.imp || {}), ...p } });
      const CLS_IDS = C.map((k) => k.id);
      const findSampler = async () => {
        const wins = [window]; try { if (window.parent && window.parent !== window) wins.push(window.parent); } catch (e) {} try { if (window.top && wins.indexOf(window.top) < 0) wins.push(window.top); } catch (e) {}
        for (const w of wins) { try { if (w.claude && typeof w.claude.use === 'function') { const s = await w.claude.use('sample'); if (s) return { s, w }; } } catch (e) {} }
        return null; };
      const PROMPT = 'These photos show a filled-in, physical Daggerheart TTRPG character sheet (possibly front and back, possibly handwritten). Read everything written or marked on it.\n'
        + 'Reply with ONLY one JSON object of this shape. Use "" or null for anything blank or unreadable; never invent values. Trait and Experience modifiers are strings like "+1", "0", "-1".\n'
        + '{"name":"","pronouns":"","level":1,"class":"one of: ' + CLS_IDS.join(', ') + '","subclass":"","ancestry":"","community":"",'
        + '"traits":{"agility":"","strength":"","finesse":"","instinct":"","presence":"","knowledge":""},"evasion":null,"armorScore":null,'
        + '"hpMax":null,"hpMarked":0,"stressMax":null,"stressMarked":0,"hope":null,"armorSlotsMarked":0,"proficiency":null,'
        + '"primary":{"name":"","traitRange":"","damage":"","feature":""},"secondary":{"name":"","traitRange":"","damage":"","feature":""},'
        + '"armor":{"name":"","baseScore":null,"major":null,"severe":null,"feature":""},'
        + '"experiences":[{"name":"","mod":"+2"}],"inventory":"","gold":{"handfuls":0,"bags":0,"chest":false},'
        + '"domainCards":["card names written on the sheet or loadout"],"notes":"anything else written that does not fit above","unreadable":["fields you could not read clearly"]}';
      const pick = (ev) => { const fs = Array.from((ev && ev.target && ev.target.files) || []).slice(0, 4); if (!fs.length) return; (I.files || []).forEach((x) => { try { URL.revokeObjectURL(x.url); } catch (e) {} });
        setI({ files: fs.map((f) => ({ f, url: URL.createObjectURL(f), name: f.name })), err: '', data: null }); };
      const read = async () => {
        const files = (this.state.imp || {}).files || []; if (!files.length) { setI({ err: 'Add a photo of the sheet first.' }); return; }
        setI({ busy: true, err: '', data: null, ctl: null });
        const got = await findSampler();
        if (!got) { setI({ busy: false, err: 'Reading photos needs Claude, which isn’t reachable from this view. Open the campaign manager on claude.ai to use photo import.' }); return; }
        const { s, w } = got; let lim = null; try { lim = await s.limits(); } catch (e) {}
        if (!lim || !lim.images) { setI({ busy: false, err: 'This view can’t send images to Claude. Try the claude.ai app or website.' }); return; }
        const ctl = new w.AbortController(); setI({ ctl });
        try {
          const blobs = await Promise.all(files.slice(0, lim.images.maxCount).map(async (x) => new w.Blob([await x.f.arrayBuffer()], { type: x.f.type || 'image/jpeg' })));
          const data = await s.json(PROMPT, { images: blobs, signal: ctl.signal, modelTier: 'default' });
          if (!data || typeof data !== 'object') throw { code: 'invalid_json' };
          setI({ busy: false, ctl: null, data, ed: {} });
        } catch (e) {
          const code = e && e.code; const msg = { cancelled: '', not_granted: 'Claude wasn’t allowed to read the photo.', rate_limited: 'Too many requests right now. Try again in a minute.', image_rejected: 'That image couldn’t be used. Try a clearer JPEG or PNG under 20 MB.', invalid_json: 'Claude couldn’t turn the sheet into data. Try a sharper, straight-on photo.', refused: 'Claude declined to read this image.', session_expired: 'Sign in to claude.ai again, then retry.' }[code];
          setI({ busy: false, ctl: null, err: msg != null ? msg : 'Reading failed. Try again with a clearer photo.' });
        } };
      const D = I.data || null; const ed = I.ed || {};
      const val = (k, dflt) => (ed[k] != null ? ed[k] : dflt == null ? '' : String(dflt));
      const setEd = (ev) => { const k = ev.target.getAttribute('data-k'); setI({ ed: { ...((this.state.imp || {}).ed || {}), [k]: ev.target.value } }); };
      const T6 = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];
      const normMod = (v) => { const n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10); return isNaN(n) ? '+0' : (n >= 0 ? '+' : '') + n; };
      const fuzzy = (list, name) => { const n = String(name || '').toLowerCase().replace(/[^a-z]/g, ''); if (!n) return null; return list.find((x) => x.toLowerCase().replace(/[^a-z]/g, '') === n) || list.find((x) => { const y = x.toLowerCase().replace(/[^a-z]/g, ''); return y.includes(n) || n.includes(y); }) || null; };
      let review = null;
      if (D) {
        const clsGuess = fuzzy(CLS_IDS, D.class) || '';
        const clsId = val('cls', clsGuess); const K = C.find((k) => k.id === clsId) || null;
        const allCards = this.domainCards(); const cardNames = allCards.map((c) => c.name);
        const cardsIn = Array.isArray(D.domainCards) ? D.domainCards.filter(Boolean) : [];
        const matched = cardsIn.map((n) => fuzzy(cardNames, n)).filter(Boolean); const unmatched = cardsIn.filter((n) => !fuzzy(cardNames, n));
        const exps = (Array.isArray(D.experiences) ? D.experiences : []).filter((x) => x && x.name).slice(0, 5);
        const P = D.primary || {}, S = D.secondary || {}, A = D.armor || {};
        const field = (k, label, dflt, wide) => ({ k, label, v: val(k, dflt), wide: wide ? 'grid-column: span 2;' : '' });
        review = {
          fields: [field('name', 'Name', D.name, true), field('pron', 'Pronouns', D.pronouns), field('level', 'Level', D.level || 1), field('ancestry', 'Ancestry', D.ancestry), field('community', 'Community', D.community), field('sub', 'Subclass', D.subclass)],
          clsOpts: [{ v: '', label: 'Pick a class…' }].concat(CLS_IDS.map((x) => ({ v: x, label: x }))), cls: clsId, clsMissing: !K,
          traits: T6.map((t) => field('t_' + t, t.charAt(0).toUpperCase() + t.slice(1), normMod((D.traits || {})[t]))),
          stats: [field('evasion', 'Evasion', D.evasion != null ? D.evasion : K ? K.ev : ''), field('armorScore', 'Armor', D.armorScore), field('hpMax', 'HP slots', D.hpMax != null ? D.hpMax : K ? K.hp : 6), field('hp', 'HP marked', D.hpMarked || 0), field('stressMax', 'Stress slots', D.stressMax || 6), field('stress', 'Stress marked', D.stressMarked || 0), field('hope', 'Hope', D.hope != null ? D.hope : 2), field('armorM', 'Armor marked', D.armorSlotsMarked || 0)],
          lines: [
            ['Primary', [P.name, P.traitRange, P.damage, P.feature].filter(Boolean).join(' · ') || '—'],
            ['Secondary', [S.name, S.traitRange, S.damage, S.feature].filter(Boolean).join(' · ') || '—'],
            ['Armor', [A.name, A.baseScore != null && A.baseScore !== '' ? 'score ' + A.baseScore : '', (A.major || A.severe) ? A.major + ' / ' + A.severe : '', A.feature].filter(Boolean).join(' · ') || '—'],
            ['Experiences', exps.map((x) => x.name + ' ' + normMod(x.mod || '+2')).join(' · ') || '—'],
            ['Domain cards', (matched.join(', ') || '—') + (unmatched.length ? '  ·  not recognised: ' + unmatched.join(', ') : '')],
            ['Inventory', String(D.inventory || '—').replace(/\n+/g, ' · ')],
            ['Gold', (D.gold ? [(D.gold.handfuls || 0) + ' handfuls', (D.gold.bags || 0) + ' bags', D.gold.chest ? 'a chest' : ''].filter(Boolean).join(', ') : '—')],
            ['Notes', D.notes || '—']].map(([label, text]) => ({ label, text })),
          unclear: Array.isArray(D.unreadable) && D.unreadable.length ? 'Couldn’t read clearly: ' + D.unreadable.join(', ') + '. Check these against the sheet.' : '',
          create: () => {
            if (!K) { setI({ err: 'Pick the character’s class first.' }); return; }
            const num = (k, d) => { const n = parseInt(val(k, ''), 10); return isNaN(n) ? d : n; };
            const lvl = Math.min(10, Math.max(1, num('level', parseInt(D.level, 10) || 1)));
            const sub = fuzzy(K.subs || [], val('sub', D.subclass)) || val('sub', D.subclass) || '';
            const fx = { name: val('name', D.name).trim() || 'Unnamed hero', gender: val('pron', D.pronouns), gmode: 'pronouns', level: String(lvl), ancestry: val('ancestry', D.ancestry), community: val('community', D.community), subclass: sub, domains: K.domains,
              evasion: String(num('evasion', K.ev)), hopeFeat: K.hopeName + ': ' + K.hope, features: K.features, imported: 'photo' };
            T6.forEach((t) => { fx[t] = normMod(val('t_' + t, normMod((D.traits || {})[t]))); });
            exps.forEach((x, i) => { fx['exp' + (i + 1)] = String(x.name).trim(); fx['exp' + (i + 1) + 'm'] = normMod(x.mod || '+2'); });
            if (P.name) { fx.p1n = P.name; fx.p1t = P.traitRange || ''; fx.p1d = P.damage || ''; fx.p1f = P.feature || ''; }
            if (S.name) { fx.p2n = S.name; fx.p2t = S.traitRange || ''; fx.p2d = S.damage || ''; fx.p2f = S.feature || ''; }
            if (A.name) { fx.aName = A.name; fx.aBase = A.baseScore != null ? String(A.baseScore) : ''; fx.aMaj = A.major != null ? String(A.major) : ''; fx.aSev = A.severe != null ? String(A.severe) : ''; fx.aFeat = A.feature || ''; }
            const asc = val('armorScore', D.armorScore); if (asc !== '') fx.armorScore = asc;
            if (D.inventory) fx.invOther = String(D.inventory);
            if (D.notes) fx.features = K.features + '\n\nFrom the paper sheet:\n' + D.notes;
            const ids = matched.map((n) => (allCards.find((c) => c.name === n) || {}).id).filter(Boolean); fx.cards = ids; fx.loadout = ids.slice(0, 5);
            const hpMax = Math.max(1, Math.min(12, num('hpMax', K.hp))); const stressMax = Math.max(1, Math.min(12, num('stressMax', 6)));
            const nc = { cls: C.indexOf(K), clsName: K.id, wither: 0, hpMax, stressMax, hp: Math.min(hpMax, Math.max(0, num('hp', 0))), stress: Math.min(stressMax, Math.max(0, num('stress', 0))), hope: Math.min(6, Math.max(0, num('hope', 2))), armor: Math.max(0, num('armorM', 0)), prof: 1,
              handfuls: (D.gold && +D.gold.handfuls) || 0, bags: (D.gold && +D.gold.bags) || 0, chest: !!(D.gold && D.gold.chest), f: fx };
            (I.files || []).forEach((x) => { try { URL.revokeObjectURL(x.url); } catch (e) {} });
            save(chars.concat([nc]), { imp: null, open: chars.length, page: 1, savedMsg: fx.name + ' was imported from the photo. Check the sheet for anything the photo missed.' });
          } };
      }
      return { open: !!I.open, show: () => setI({ open: true, err: '' }), close: () => { if (I.ctl) try { I.ctl.abort(); } catch (e) {} (I.files || []).forEach((x) => { try { URL.revokeObjectURL(x.url); } catch (e) {} }); this.setState({ imp: null }); },
        pick, read, stop: () => { if (I.ctl) try { I.ctl.abort(); } catch (e) {} setI({ busy: false, ctl: null }); },
        thumbs: (I.files || []).map((x) => ({ style: 'width: 120px; height: 160px; flex: none; border-radius: 10px; border: 1px solid #3a4d54; background: #0b1214 center / cover no-repeat url(' + x.url + ');', name: x.name })),
        hasFiles: !!(I.files && I.files.length), noFiles: !(I.files && I.files.length), busy: !!I.busy, idle: !I.busy, err: I.err || '', hasErr: !!I.err,
        hasReview: !!review, noReview: !review, rv: review || { fields: [], clsOpts: [], cls: '', clsMissing: false, traits: [], stats: [], lines: [], unclear: '', create: () => {} }, hasUnclear: !!(review && review.unclear), setEd,
        setCls: (ev) => setI({ ed: { ...((this.state.imp || {}).ed || {}), cls: ev.target.value } }), readLabel: review ? 'Read again' : 'Read the sheet' };
    })();
