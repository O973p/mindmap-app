/* Mindmap-Editor: unendliche Zeichenfläche mit Pan/Zoom, Text-Knoten,
   Bildern, Verbindungen, Undo/Redo und Auto-Save. */
const Editor = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['default', 'blue', 'green', 'yellow', 'red', 'purple', 'gray'];
  // Linienfarben passend zu den Knoten-Farben (funktionieren in Hell und Dunkel)
  const EDGE_COLORS = {
    blue: '#60a5fa', green: '#4ade80', yellow: '#eab308',
    red: '#f87171', purple: '#c084fc', gray: '#9ca3af',
  };
  const COLOR_PREVIEW = {
    default: ['#ffffff', '#23262e'],
    blue: ['#93c5fd', '#3b6ea5'], green: ['#86efac', '#2f7d51'],
    yellow: ['#fde047', '#8f7c28'], red: ['#fca5a5', '#94403c'],
    purple: ['#d8b4fe', '#6d4a96'], gray: ['#c3c8d0', '#4a505b'],
  };

  let canvas, world, svg, selbar, selbarColors, titleInput, btnUndo, btnRedo;

  let mapRec = null;
  let nodes = [], edges = [];
  let view = { x: 0, y: 0, s: 1 };
  let sel = null;            // {type:'node'|'edge', id}
  let editingId = null;      // Knoten, dessen Text gerade bearbeitet wird
  let connecting = null;     // {from, pos:{x,y}} während eine Verbindung gezogen wird
  let els = new Map();       // nodeId -> DOM-Element
  let history = [], hIdx = -1;
  let saveTimer = null;
  let pinch = null;          // aktiver Zwei-Finger-Zoom (Touch)
  const pointers = new Map(); // aktive Pointer auf dem Canvas (für Pinch)
  let fileCtx = null;        // Datei-Modus: {handle?, fileName, dirty} — statt Store
  let sizeMode = 'manual';   // 'manual' (klassisch) | 'auto' (dynamisch, nach Astgröße)
  const autoScales = new Map(); // nodeId -> berechneter Größenfaktor (nur im auto-Modus)
  let toastTimer = null;

  /* ---------- Hilfen ---------- */

  const nodeById = id => nodes.find(n => n.id === id);
  const edgeById = id => edges.find(e => e.id === id);
  const editorVisible = () => document.getElementById('editor').classList.contains('active');

  function worldPos(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - view.x) / view.s,
      y: (ev.clientY - r.top - view.y) / view.s,
    };
  }

  function nodeCenter(n) {
    const el = els.get(n.id);
    if (!el) return { x: n.x, y: n.y };
    return { x: n.x + el.offsetWidth / 2, y: n.y + el.offsetHeight / 2 };
  }

  function drag(onMove, onUp) {
    const move = ev => { if (pinch) return; onMove(ev); }; // während Pinch pausieren
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (onUp) onUp(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---------- Verlauf (Undo/Redo) & Speichern ---------- */

  const snap = () => JSON.stringify({ nodes, edges, sizeMode });

  function pushHistory() {
    const s = snap();
    if (s === history[hIdx]) { scheduleSave(); return; }
    history = history.slice(0, hIdx + 1);
    history.push(s);
    if (history.length > 100) history.shift();
    hIdx = history.length - 1;
    updateUndoButtons();
    scheduleSave();
  }

  function restore(s) {
    const d = JSON.parse(s);
    nodes = d.nodes; edges = d.edges;
    sizeMode = d.sizeMode || 'manual';
    sel = null; editingId = null; connecting = null;
    applySizeModeUi();
    render();
    scheduleSave();
  }

  function undo() { if (hIdx > 0) { hIdx--; restore(history[hIdx]); updateUndoButtons(); } }
  function redo() { if (hIdx < history.length - 1) { hIdx++; restore(history[hIdx]); updateUndoButtons(); } }

  function updateUndoButtons() {
    btnUndo.disabled = hIdx <= 0;
    btnRedo.disabled = hIdx >= history.length - 1;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    if (!mapRec) return;
    mapRec.name = titleInput.value.trim() || 'Unbenannt';
    mapRec.updatedAt = Date.now();
    mapRec.data = { nodes, edges, view, sizeMode };
    if (fileCtx) return saveToFile();
    try {
      await Store.put(mapRec);
    } catch (_) {
      // Server kurz nicht erreichbar — nächster Auto-Save versucht es erneut
      scheduleSave();
    }
  }

  /* ---------- Datei-Modus ---------- */

  function filePayload() {
    return { app: 'mindmap-app', version: 1, name: mapRec.name, data: { nodes, edges, view, sizeMode } };
  }

  async function saveToFile() {
    if (fileCtx.handle) {
      try {
        const w = await fileCtx.handle.createWritable();
        await w.write(JSON.stringify(filePayload()));
        await w.close();
        fileCtx.dirty = false;
        updateFileUi();
        return;
      } catch (_) { /* Schreibrecht weg — auf manuelles Speichern umschalten */ }
    }
    fileCtx.dirty = true;
    updateFileUi();
  }

  function updateFileUi() {
    const badge = document.getElementById('file-badge');
    const saveBtn = document.getElementById('btn-save-file');
    if (fileCtx) {
      badge.hidden = false;
      badge.textContent = fileCtx.fileName + (fileCtx.dirty ? ' •' : '');
      saveBtn.hidden = !(fileCtx.dirty || !fileCtx.handle);
      saveBtn.classList.toggle('attention', !!fileCtx.dirty);
    } else {
      badge.hidden = true;
      saveBtn.hidden = true;
    }
  }

  /* Öffnet eine .mindmap.json — source: {handle} (File-System-API) oder {file} (Fallback) */
  async function openFile(source) {
    let text, handle = null, fileName;
    if (source.handle) {
      handle = source.handle;
      const f = await handle.getFile();
      text = await f.text();
      fileName = f.name;
    } else {
      text = await source.file.text();
      fileName = source.file.name;
    }
    const json = JSON.parse(text);
    const nds = json.data?.nodes ?? json.nodes;
    if (!Array.isArray(nds)) throw new Error('keine Knoten gefunden');

    mapRec = {
      id: 'file-' + uid(),
      name: (json.name || fileName.replace(/\.mindmap\.json$|\.json$/i, '')).trim() || 'Unbenannt',
      createdAt: Date.now(), updatedAt: Date.now(), data: {},
    };
    nodes = nds;
    edges = json.data?.edges ?? json.edges ?? [];
    view = json.data?.view || { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, s: 1 };
    sizeMode = json.data?.sizeMode || 'manual';
    fileCtx = { handle, fileName, dirty: false };
    resetSession();
  }

  /* "Als Datei…": aktuelle Map in eine Datei speichern und ab dann dort weiterarbeiten */
  async function saveAsFile() {
    if (editingId) finishEdit();
    let handle;
    try {
      handle = await showSaveFilePicker({
        suggestedName: (titleInput.value.trim() || 'mindmap') + '.mindmap.json',
        types: [{ description: 'Mindmap-Datei', accept: { 'application/json': ['.json'] } }],
      });
    } catch (_) { return; /* Dialog abgebrochen */ }
    fileCtx = { handle, fileName: handle.name, dirty: false };
    await saveNow();
    updateFileUi();
  }

  /* ---------- Dynamische Größen (auto-Modus) ---------- */

  /* Hierarchie ergibt sich aus den Verbindungen: Breitensuche von allen
     Hauptknoten aus; jeder Knoten wächst logarithmisch mit der Zahl ALLER
     seiner Unterknoten (ganzer Ast), hart gedeckelt (Text ×3, Bild ×2). */
  function computeAutoScales() {
    autoScales.clear();
    if (sizeMode !== 'auto') return;
    const roots = nodes.filter(n => n.root).map(n => n.id);
    if (!roots.length) return; // ohne Hauptknoten: alles neutral

    const adj = new Map(nodes.map(n => [n.id, []]));
    for (const e of edges) {
      if (adj.has(e.from) && adj.has(e.to)) {
        adj.get(e.from).push(e.to);
        adj.get(e.to).push(e.from);
      }
    }

    // Multi-Source-BFS: Eltern-Zuordnung über den kürzesten Weg zum Hauptknoten
    const parent = new Map();
    const visited = new Set(roots);
    const order = [...roots];
    for (let i = 0; i < order.length; i++) {
      for (const nb of adj.get(order[i]) || []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          parent.set(nb, order[i]);
          order.push(nb);
        }
      }
    }

    // Astgrößen rückwärts aufsummieren (Kinder vor Eltern)
    const desc = new Map(order.map(id => [id, 0]));
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i], p = parent.get(id);
      if (p !== undefined) desc.set(p, desc.get(p) + desc.get(id) + 1);
    }

    for (const id of order) {
      const n = nodeById(id);
      if (!n) continue;
      const growth = 1 + 0.25 * Math.log2(1 + desc.get(id));
      autoScales.set(id, n.type === 'image'
        ? Math.min(2, growth)
        : Math.min(3, (n.root ? 1.6 : 1) * growth));
    }
  }

  function applySizeModeUi() {
    const btn = document.getElementById('btn-sizemode');
    const auto = sizeMode === 'auto';
    btn.classList.toggle('active', auto);
    btn.title = auto
      ? 'Größenmodus: dynamisch (Größe folgt der Astgröße) — Klick für klassisch'
      : 'Größenmodus: klassisch (manuell änderbar) — Klick für dynamisch';
    canvas.classList.toggle('auto-size', auto);
  }

  function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      canvas.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4500);
  }

  /* ---------- Rendering ---------- */

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    canvas.style.backgroundSize = `${24 * view.s}px ${24 * view.s}px`;
    canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
    positionSelbar();
  }

  function render() {
    computeAutoScales();
    const seen = new Set();
    for (const n of nodes) {
      let el = els.get(n.id);
      if (!el) { el = createNodeEl(n); world.appendChild(el); els.set(n.id, el); }
      updateNodeEl(el, n);
      seen.add(n.id);
    }
    for (const [id, el] of [...els]) {
      if (!seen.has(id)) { el.remove(); els.delete(id); }
    }
    renderEdges();
    positionSelbar();
  }

  function createNodeEl(n) {
    const el = document.createElement('div');
    el.className = 'node';
    el.dataset.id = n.id;

    if (n.type === 'image') {
      el.classList.add('image');
      const img = document.createElement('img');
      img.draggable = false;
      img.src = n.src;
      img.addEventListener('load', renderEdges);
      el.appendChild(img);
    } else {
      el.classList.add('text');
      const t = document.createElement('div');
      t.className = 'node-text';
      el.appendChild(t);
    }

    // Größen-Griff für Bilder UND Text (Text: skaliert die Schriftgröße)
    const rz = document.createElement('div');
    rz.className = 'resize';
    el.appendChild(rz);

    for (const side of ['t', 'r', 'b', 'l']) {
      const h = document.createElement('div');
      h.className = 'handle h-' + side;
      el.appendChild(h);
    }

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const id = el.dataset.id;
      if (e.target.classList.contains('handle')) {
        e.stopPropagation(); e.preventDefault();
        startConnect(id, e);
        return;
      }
      if (e.target.classList.contains('resize')) {
        e.stopPropagation(); e.preventDefault();
        startResize(id, e);
        return;
      }
      e.stopPropagation();
      if (editingId === id) return; // beim Tippen normale Textauswahl erlauben
      select({ type: 'node', id });
      startNodeDrag(id, e);
    });

    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      const n2 = nodeById(el.dataset.id);
      if (n2 && n2.type !== 'image') startEdit(n2.id);
    });

    return el;
  }

  function updateNodeEl(el, n) {
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.classList.toggle('selected', !!(sel && sel.type === 'node' && sel.id === n.id));
    el.classList.toggle('root', !!n.root);

    if (n.type === 'image') {
      const f = sizeMode === 'auto' ? (autoScales.get(n.id) || 1) : 1;
      const img = el.querySelector('img');
      img.style.width = Math.round(n.w * f) + 'px';
      img.style.height = Math.round(n.h * f) + 'px';
    } else {
      for (const c of COLORS) el.classList.toggle('c-' + c, n.color === c && c !== 'default');
      const fs = sizeMode === 'auto' ? (autoScales.get(n.id) || 1) : (n.fs || 1);
      el.style.fontSize = (14 * fs) + 'px';
      el.style.maxWidth = Math.round(280 * fs) + 'px';
      const t = el.querySelector('.node-text');
      if (editingId !== n.id && t.innerText !== n.text) t.innerText = n.text;
    }
  }

  function edgePath(a, b) {
    const dx = b.x - a.x;
    const k = Math.max(30, Math.abs(dx) * 0.4) * (dx >= 0 ? 1 : -1);
    return `M ${a.x} ${a.y} C ${a.x + k} ${a.y}, ${b.x - k} ${b.y}, ${b.x} ${b.y}`;
  }

  /* Bestimmt die Linienfarbe: einfarbig, wenn beide Enden dieselbe Farbe haben;
     Farbverlauf (Fade bis zur Mitte), wenn nur ein Ende (oder beide verschieden)
     gefärbt sind; sonst Standard. Gibt null (= Standard) oder einen Stroke-Wert zurück. */
  function edgeStroke(e, from, to, a, b, defs) {
    const ca = EDGE_COLORS[from.color] || null;
    const cb = EDGE_COLORS[to.color] || null;
    if (!ca && !cb) return null;
    if (ca && cb && from.color === to.color) return ca;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return ca || cb; // entartete Linie: Gradient wäre unsichtbar

    const g = document.createElementNS(SVG_NS, 'linearGradient');
    g.id = 'g-' + e.id;
    g.setAttribute('gradientUnits', 'userSpaceOnUse');
    g.setAttribute('x1', a.x); g.setAttribute('y1', a.y);
    g.setAttribute('x2', b.x); g.setAttribute('y2', b.y);
    const stops = (ca && cb)
      ? [[0, ca], [1, cb]]                                   // zwei Farben: durchgehender Verlauf
      : ca
        ? [[0, ca], [0.5, null], [1, null]]                  // Farbe verläuft bis zur Mitte in Standard
        : [[0, null], [0.5, null], [1, cb]];
    for (const [off, col] of stops) {
      const st = document.createElementNS(SVG_NS, 'stop');
      st.setAttribute('offset', off);
      if (col) st.setAttribute('stop-color', col);
      else st.style.stopColor = 'var(--edge)';
      g.appendChild(st);
    }
    defs.appendChild(g);
    return `url(#${g.id})`;
  }

  function renderEdges() {
    svg.replaceChildren();
    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defs);
    for (const e of edges) {
      const from = nodeById(e.from), to = nodeById(e.to);
      if (!from || !to) continue;
      const a = nodeCenter(from), b = nodeCenter(to);
      const d = edgePath(a, b);
      const selected = sel && sel.type === 'edge' && sel.id === e.id;

      const vis = document.createElementNS(SVG_NS, 'path');
      vis.setAttribute('d', d);
      vis.setAttribute('class', 'edge' + (selected ? ' selected' : ''));
      if (!selected) {
        const stroke = edgeStroke(e, from, to, a, b, defs);
        if (stroke) vis.style.stroke = stroke;
      }
      svg.appendChild(vis);

      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'edge-hit');
      hit.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        select({ type: 'edge', id: e.id });
      });
      svg.appendChild(hit);
    }

    if (connecting && connecting.pos) {
      const from = nodeById(connecting.from);
      if (from) {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', edgePath(nodeCenter(from), connecting.pos));
        p.setAttribute('class', 'edge temp');
        svg.appendChild(p);
      }
    }
  }

  /* ---------- Auswahl & schwebende Leiste ---------- */

  function select(s) {
    sel = s;
    render();
  }

  function positionSelbar() {
    if (!sel) { selbar.hidden = true; return; }

    let bx, topAnchor, bottomAnchor, node = null;
    if (sel.type === 'node') {
      node = nodeById(sel.id);
      const el = els.get(sel.id);
      if (!node || !el) { selbar.hidden = true; return; }
      bx = view.x + (node.x + el.offsetWidth / 2) * view.s;
      topAnchor = view.y + node.y * view.s - 10;
      bottomAnchor = view.y + (node.y + el.offsetHeight) * view.s + 10;
    } else {
      const e = edgeById(sel.id);
      if (!e) { selbar.hidden = true; return; }
      const a = nodeCenter(nodeById(e.from)), b = nodeCenter(nodeById(e.to));
      bx = view.x + ((a.x + b.x) / 2) * view.s;
      topAnchor = view.y + ((a.y + b.y) / 2) * view.s - 10;
      bottomAnchor = topAnchor + 20;
    }

    // Farbpalette und Stern nur für Text-Knoten, Reset nur im klassischen Modus
    const showColors = node && node.type !== 'image';
    selbarColors.style.display = showColors ? 'flex' : 'none';
    if (showColors) {
      for (const b of selbarColors.children) {
        b.classList.toggle('active', (node.color || 'default') === b.dataset.color);
      }
    }
    const rootBtn = document.getElementById('selbar-root');
    rootBtn.style.display = showColors ? '' : 'none';
    rootBtn.classList.toggle('active', !!(node && node.root));
    rootBtn.title = node && node.root ? 'Hauptknoten-Markierung entfernen' : 'Als Hauptknoten markieren';
    document.getElementById('selbar-reset').style.display =
      (node && sizeMode === 'manual') ? '' : 'none';

    // Innerhalb des Canvas halten; wenn oben kein Platz ist, unter das Element klappen
    selbar.hidden = false;
    const bw = selbar.offsetWidth, bh = selbar.offsetHeight;
    const left = Math.min(Math.max(bx, bw / 2 + 6), Math.max(bw / 2 + 6, canvas.clientWidth - bw / 2 - 6));
    const below = topAnchor - bh < 6;
    selbar.style.left = left + 'px';
    selbar.style.top = (below ? bottomAnchor : topAnchor) + 'px';
    selbar.style.transform = below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
  }

  function deleteSelection() {
    if (!sel) return;
    if (sel.type === 'node') {
      const id = sel.id;
      nodes = nodes.filter(n => n.id !== id);
      edges = edges.filter(e => e.from !== id && e.to !== id);
    } else {
      edges = edges.filter(e => e.id !== sel.id);
    }
    sel = null;
    pushHistory();
    render();
  }

  /* ---------- Interaktionen: Pan, Zoom, Drag, Verbinden ---------- */

  function startPan(e) {
    canvas.classList.add('panning');
    let lx = e.clientX, ly = e.clientY;
    drag(ev => {
      view.x += ev.clientX - lx;
      view.y += ev.clientY - ly;
      lx = ev.clientX; ly = ev.clientY;
      applyView();
    }, () => {
      canvas.classList.remove('panning');
      scheduleSave();
    });
  }

  function startNodeDrag(id, e) {
    const n = nodeById(id);
    const start = worldPos(e);
    const nx = n.x, ny = n.y;
    let moved = false;
    drag(ev => {
      const p = worldPos(ev);
      n.x = nx + (p.x - start.x);
      n.y = ny + (p.y - start.y);
      moved = true;
      const el = els.get(id);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
      renderEdges();
      positionSelbar();
    }, () => {
      if (moved) pushHistory();
    });
  }

  function startConnect(id, e) {
    connecting = { from: id, pos: worldPos(e) };
    drag(ev => {
      connecting.pos = worldPos(ev);
      renderEdges();
    }, ev => {
      const targetEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
      const targetId = targetEl?.dataset.id;
      connecting = null;
      if (targetId && targetId !== id && !edges.some(x =>
        (x.from === id && x.to === targetId) || (x.from === targetId && x.to === id))) {
        edges.push({ id: uid(), from: id, to: targetId });
        pushHistory();
        render(); // volle Neuzeichnung: im dynamischen Modus ändern sich Größen
      } else {
        renderEdges();
      }
    });
  }

  function startResize(id, e) {
    const n = nodeById(id);
    const el = els.get(id);
    let moved = false;

    if (n.type === 'image') {
      const ratio = n.w / n.h;
      drag(ev => {
        const p = worldPos(ev);
        n.w = Math.max(60, p.x - n.x);
        n.h = n.w / ratio;
        moved = true;
        if (el) updateNodeEl(el, n);
        renderEdges();
        positionSelbar();
      }, () => { if (moved) pushHistory(); });
    } else {
      // Text: Ziehen skaliert die Schriftgröße
      const startFs = n.fs || 1;
      const startW = el ? el.offsetWidth : 100;
      drag(ev => {
        const p = worldPos(ev);
        n.fs = Math.min(4, Math.max(0.5, startFs * ((p.x - n.x) / startW)));
        moved = true;
        if (el) updateNodeEl(el, n);
        renderEdges();
        positionSelbar();
      }, () => { if (moved) pushHistory(); });
    }
  }

  /* ---------- Text bearbeiten ---------- */

  function startEdit(id) {
    if (editingId && editingId !== id) finishEdit();
    const el = els.get(id);
    if (!el) return;
    editingId = id;
    sel = { type: 'node', id };
    el.classList.add('editing');
    const t = el.querySelector('.node-text');
    try { t.contentEditable = 'plaintext-only'; } catch { t.contentEditable = 'true'; }
    t.focus();
    const range = document.createRange();
    range.selectNodeContents(t);
    const s = getSelection();
    s.removeAllRanges(); s.addRange(range);

    t.onblur = () => finishEdit();
    t.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); t.blur(); }
    };
  }

  function finishEdit() {
    if (!editingId) return;
    const id = editingId;
    editingId = null;
    const el = els.get(id);
    const n = nodeById(id);
    if (el) {
      const t = el.querySelector('.node-text');
      t.onblur = null; t.onkeydown = null;
      t.contentEditable = 'false';
      el.classList.remove('editing');
      const text = t.innerText.replace(/ /g, ' ').trim();
      if (n) {
        if (!text) {
          // Leerer Knoten wird verworfen
          nodes = nodes.filter(x => x.id !== id);
          edges = edges.filter(e => e.from !== id && e.to !== id);
          if (sel && sel.type === 'node' && sel.id === id) sel = null;
        } else {
          n.text = text;
        }
      }
    }
    pushHistory();
    render();
  }

  /* ---------- Knoten anlegen ---------- */

  function addTextNode(x, y) {
    const n = { id: uid(), type: 'text', x: Math.round(x - 55), y: Math.round(y - 19), text: '', color: 'default' };
    nodes.push(n);
    render();
    startEdit(n.id);
  }

  function addImageFile(file, cx, cy) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let src = reader.result;
        // Sehr große Bilder verkleinern, damit die Datenbank schlank bleibt
        const MAX = 1400;
        if (img.naturalWidth > MAX || img.naturalHeight > MAX) {
          const f = MAX / Math.max(img.naturalWidth, img.naturalHeight);
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * f);
          c.height = Math.round(img.naturalHeight * f);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          src = file.type === 'image/png'
            ? c.toDataURL('image/png')
            : c.toDataURL('image/jpeg', 0.85);
        }
        const w = Math.min(340, img.naturalWidth);
        const h = img.naturalHeight * (w / img.naturalWidth);
        nodes.push({
          id: uid(), type: 'image', src,
          x: Math.round(cx - w / 2), y: Math.round(cy - h / 2),
          w: Math.round(w), h: Math.round(h),
        });
        pushHistory();
        render();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- Öffnen ---------- */

  async function open(id) {
    mapRec = await Store.get(id);
    if (!mapRec) return;
    nodes = mapRec.data?.nodes || [];
    edges = mapRec.data?.edges || [];
    view = mapRec.data?.view || { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, s: 1 };
    sizeMode = mapRec.data?.sizeMode || 'manual';
    fileCtx = null;
    resetSession();
  }

  function resetSession() {
    sel = null; editingId = null; connecting = null;
    for (const el of els.values()) el.remove();
    els.clear();
    history = [snap()]; hIdx = 0;
    titleInput.value = mapRec.name;
    updateUndoButtons();
    updateFileUi();
    applySizeModeUi();
    applyView();
    render();
  }

  function currentRecord() {
    return { ...mapRec, name: titleInput.value.trim() || 'Unbenannt', data: { nodes, edges, view } };
  }

  /* ---------- Initialisierung ---------- */

  function init() {
    canvas = document.getElementById('canvas');
    world = document.getElementById('world');
    svg = document.getElementById('edge-layer');
    selbar = document.getElementById('selbar');
    selbarColors = document.getElementById('selbar-colors');
    titleInput = document.getElementById('map-title');
    btnUndo = document.getElementById('btn-undo');
    btnRedo = document.getElementById('btn-redo');

    // Farbpalette aufbauen
    const dark = () => document.documentElement.dataset.theme === 'dark';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.dataset.color = c;
      b.title = c === 'default' ? 'Standard' : c;
      const setBg = () => { b.style.background = COLOR_PREVIEW[c][dark() ? 1 : 0]; };
      setBg();
      new MutationObserver(setBg).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      // Kein preventDefault hier: das würde auf Touch-Geräten den Klick verschlucken
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('click', () => {
        if (sel && sel.type === 'node') {
          const n = nodeById(sel.id);
          if (n && n.type !== 'image') { n.color = c; pushHistory(); render(); }
        }
      });
      selbarColors.appendChild(b);
    }

    const delBtn = document.getElementById('selbar-delete');
    delBtn.addEventListener('pointerdown', e => e.stopPropagation());
    delBtn.addEventListener('click', deleteSelection);

    // Hauptknoten markieren (Stern)
    const rootBtn = document.getElementById('selbar-root');
    rootBtn.addEventListener('pointerdown', e => e.stopPropagation());
    rootBtn.addEventListener('click', () => {
      if (!sel || sel.type !== 'node') return;
      const n = nodeById(sel.id);
      if (!n || n.type === 'image') return;
      n.root = !n.root;
      pushHistory();
      render();
    });

    // Größe zurücksetzen (nur klassischer Modus)
    const resetBtn = document.getElementById('selbar-reset');
    resetBtn.addEventListener('pointerdown', e => e.stopPropagation());
    resetBtn.addEventListener('click', () => {
      if (!sel || sel.type !== 'node') return;
      const n = nodeById(sel.id);
      if (!n) return;
      if (n.type === 'image') {
        const img = els.get(n.id)?.querySelector('img');
        if (img && img.naturalWidth) {
          const bw = Math.min(340, img.naturalWidth);
          n.w = Math.round(bw);
          n.h = Math.round(img.naturalHeight * (bw / img.naturalWidth));
        }
      } else {
        n.fs = 1;
      }
      pushHistory();
      render();
    });

    // Größenmodus umschalten (klassisch <-> dynamisch)
    document.getElementById('btn-sizemode').addEventListener('click', () => {
      sizeMode = sizeMode === 'auto' ? 'manual' : 'auto';
      applySizeModeUi();
      if (sizeMode === 'auto' && !nodes.some(n => n.root)) {
        showToast('Dynamische Größe ist an — markiere einen Knoten und tippe auf den Stern, um den Hauptknoten festzulegen.');
      }
      pushHistory();
      render();
    });

    // Pan & Auswahl aufheben
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 1) { e.preventDefault(); startPan(e); return; }
      if (e.button !== 0) return;
      if (e.target.closest('.node') || e.target.closest('#selbar')) return;
      select(null);
      startPan(e);
    });

    // Zwei-Finger-Pinch-Zoom (Touch): Pointer auf dem Canvas mitverfolgen
    canvas.addEventListener('pointerdown', e => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const r = canvas.getBoundingClientRect();
        pinch = {
          s0: view.s, x0: view.x, y0: view.y,
          d0: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
          mx0: (p1.x + p2.x) / 2 - r.left,
          my0: (p1.y + p2.y) / 2 - r.top,
        };
      }
    }, true);
    window.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [p1, p2] = [...pointers.values()];
        const r = canvas.getBoundingClientRect();
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        const mx = (p1.x + p2.x) / 2 - r.left;
        const my = (p1.y + p2.y) / 2 - r.top;
        const ns = Math.min(3, Math.max(0.15, pinch.s0 * (d / pinch.d0)));
        view.x = mx - (pinch.mx0 - pinch.x0) * (ns / pinch.s0);
        view.y = my - (pinch.my0 - pinch.y0) * (ns / pinch.s0);
        view.s = ns;
        applyView();
      }
    });
    for (const type of ['pointerup', 'pointercancel']) {
      window.addEventListener(type, e => {
        pointers.delete(e.pointerId);
        if (pinch && pointers.size < 2) { pinch = null; scheduleSave(); }
      });
    }

    // Zoom zum Mauszeiger
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(3, Math.max(0.15, view.s * f));
      view.x = mx - (mx - view.x) * (ns / view.s);
      view.y = my - (my - view.y) * (ns / view.s);
      view.s = ns;
      applyView();
      scheduleSave();
    }, { passive: false });

    // Doppelklick auf freie Fläche: neuer Text-Knoten
    canvas.addEventListener('dblclick', e => {
      if (e.target.closest('.node') || e.target.closest('#selbar')) return;
      const p = worldPos(e);
      addTextNode(p.x, p.y);
    });

    // Bilder per Drag & Drop
    canvas.addEventListener('dragover', e => e.preventDefault());
    canvas.addEventListener('drop', e => {
      e.preventDefault();
      const p = worldPos(e);
      [...e.dataTransfer.files]
        .filter(f => f.type.startsWith('image/'))
        .forEach((f, i) => addImageFile(f, p.x + i * 40, p.y + i * 40));
    });

    // Bilder per Strg+V
    document.addEventListener('paste', e => {
      if (!editorVisible() || editingId) return;
      const t = e.target;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName))) return;
      const items = [...(e.clipboardData?.items || [])].filter(it => it.type.startsWith('image/'));
      if (!items.length) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const cx = (r.width / 2 - view.x) / view.s;
      const cy = (r.height / 2 - view.y) / view.s;
      items.forEach((it, i) => addImageFile(it.getAsFile(), cx + i * 40, cy + i * 40));
    });

    // Tastatur
    window.addEventListener('keydown', e => {
      if (!editorVisible()) return;
      const t = e.target;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); deleteSelection(); } }
      else if (e.key === 'Escape') { select(null); }
    });

    // Schnell-Buttons: neuer Knoten / Bild in der Bildschirmmitte
    const centerWorld = () => {
      const r = canvas.getBoundingClientRect();
      return { x: (r.width / 2 - view.x) / view.s, y: (r.height / 2 - view.y) / view.s };
    };
    document.getElementById('fab-node').addEventListener('click', () => {
      const c = centerWorld();
      addTextNode(c.x, c.y);
    });
    const imageInput = document.getElementById('image-file');
    document.getElementById('fab-image').addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', () => {
      const f = imageInput.files[0];
      if (f && f.type.startsWith('image/')) {
        const c = centerWorld();
        addImageFile(f, c.x, c.y);
      }
      imageInput.value = '';
    });

    btnUndo.addEventListener('click', undo);
    btnRedo.addEventListener('click', redo);
    titleInput.addEventListener('input', scheduleSave);
    titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') titleInput.blur(); });

    document.getElementById('btn-export').addEventListener('click', () => App.exportMap(currentRecord()));

    // Datei-Modus: manuelles Speichern (Fallback ohne File-System-API → Download)
    document.getElementById('btn-save-file').addEventListener('click', async () => {
      if (!fileCtx) return;
      if (editingId) finishEdit();
      await saveNow();
      if (fileCtx.dirty && fileCtx.handle && fileCtx.handle.requestPermission) {
        // Schreibrecht ggf. per Nutzergeste erneut anfragen
        try {
          if (await fileCtx.handle.requestPermission({ mode: 'readwrite' }) === 'granted') await saveToFile();
        } catch (_) {}
      }
      if (fileCtx.dirty) {
        App.downloadJson(filePayload(), fileCtx.fileName);
        fileCtx.dirty = false;
        updateFileUi();
      }
    });

    const saveAsBtn = document.getElementById('btn-save-as');
    saveAsBtn.hidden = !window.showSaveFilePicker;
    saveAsBtn.addEventListener('click', saveAsFile);

    window.addEventListener('beforeunload', e => {
      if (fileCtx && fileCtx.dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    document.getElementById('btn-back').addEventListener('click', async () => {
      if (editingId) finishEdit();
      await saveNow();
      if (fileCtx && fileCtx.dirty &&
          !confirm('Du hast ungespeicherte Änderungen in „' + fileCtx.fileName + '". Zurück ohne Speichern?')) {
        return;
      }
      fileCtx = null;
      updateFileUi();
      App.showHome();
    });
  }

  return { init, open, openFile, saveNow };
})();
