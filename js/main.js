/* Startbildschirm: Mindmaps auflisten, anlegen, umbenennen, duplizieren,
   exportieren, importieren, löschen — plus Theme-Umschaltung. */
const App = (() => {
  const fmtDate = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

  /* ---------- Theme ---------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mm-theme', theme);
    for (const id of ['btn-theme-home', 'btn-theme-editor']) {
      const b = document.getElementById(id);
      if (b) b.innerHTML = theme === 'dark' ? ICON.sun : ICON.moon;
    }
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  /* ---------- Ansichten ---------- */

  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
  }

  async function showHome() {
    showView('home');
    await renderList();
  }

  async function openMap(id) {
    showView('editor');
    await Editor.open(id);
  }

  /* ---------- Startbildschirm ---------- */

  async function renderList() {
    const list = document.getElementById('map-list');
    const empty = document.getElementById('empty-hint');
    const maps = (await Store.all()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    list.replaceChildren();
    empty.hidden = maps.length > 0;

    for (const m of maps) {
      const card = document.createElement('div');
      card.className = 'card';

      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = m.name;

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      const count = m.count ?? m.data?.nodes?.length ?? 0;
      meta.textContent = `${count} ${count === 1 ? 'Element' : 'Elemente'} · ${fmtDate.format(m.updatedAt || m.createdAt)}`;

      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const mkBtn = (icon, title2, fn, cls) => {
        const b = document.createElement('button');
        b.innerHTML = icon;
        b.title = title2;
        if (cls) b.classList.add(cls);
        b.addEventListener('click', e => { e.stopPropagation(); fn(); });
        actions.appendChild(b);
      };
      mkBtn(ICON.pencil, 'Umbenennen', async () => {
        const name = prompt('Neuer Name:', m.name);
        if (name && name.trim()) {
          const full = await Store.get(m.id) || m; // Listen-Einträge im Server-Modus enthalten keine Daten
          full.name = name.trim(); full.updatedAt = Date.now();
          await Store.put(full); renderList();
        }
      });
      mkBtn(ICON.copy, 'Duplizieren', async () => {
        const full = await Store.get(m.id) || m;
        await Store.put({ ...full, id: uid(), name: full.name + ' (Kopie)', createdAt: Date.now(), updatedAt: Date.now() });
        renderList();
      });
      mkBtn(ICON.download, 'Exportieren', async () => exportMap(await Store.get(m.id) || m));
      mkBtn(ICON.trash, 'Löschen', async () => {
        if (confirm(`„${m.name}" wirklich löschen?`)) { await Store.remove(m.id); renderList(); }
      }, 'del');

      card.append(title, meta, actions);
      card.addEventListener('click', () => openMap(m.id));
      list.appendChild(card);
    }
  }

  /* ---------- Export / Import ---------- */

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportMap(rec) {
    downloadJson({
      app: 'mindmap-app', version: 1,
      name: rec.name,
      data: {
        nodes: rec.data?.nodes || [], edges: rec.data?.edges || [],
        sizeMode: rec.data?.sizeMode || 'manual',
        groupDrag: rec.data?.groupDrag !== false,
      },
    }, (rec.name || 'mindmap') + '.mindmap.json');
  }

  async function importFile(file) {
    try {
      const json = JSON.parse(await file.text());
      const nodes = json.data?.nodes ?? json.nodes;
      const edges = json.data?.edges ?? json.edges ?? [];
      if (!Array.isArray(nodes)) throw new Error('keine Knoten gefunden');
      await Store.put({
        id: uid(),
        name: (json.name || file.name.replace(/\.mindmap\.json$|\.json$/i, '')).trim() || 'Importierte Map',
        createdAt: Date.now(), updatedAt: Date.now(),
        data: {
          nodes, edges, view: null,
          sizeMode: json.data?.sizeMode || 'manual',
          groupDrag: json.data?.groupDrag !== false,
        },
      });
      renderList();
    } catch (err) {
      alert('Import fehlgeschlagen: Die Datei ist keine gültige Mindmap-Datei.\n(' + err.message + ')');
    }
  }

  /* ---------- Zugangsschlüssel ---------- */

  function askKey(showError) {
    return new Promise(resolve => {
      const overlay = document.getElementById('key-overlay');
      const input = document.getElementById('key-input');
      const error = document.getElementById('key-error');
      error.hidden = !showError;
      overlay.hidden = false;
      input.focus();
      const submit = () => {
        const v = input.value.trim();
        if (!v) return;
        overlay.hidden = true;
        input.value = '';
        resolve(v);
      };
      document.getElementById('key-submit').onclick = submit;
      input.onkeydown = e => { if (e.key === 'Enter') submit(); };
    });
  }

  /* ---------- Initialisierung ---------- */

  async function init() {
    applyTheme(localStorage.getItem('mm-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

    document.getElementById('btn-theme-home').addEventListener('click', toggleTheme);
    document.getElementById('btn-theme-editor').addEventListener('click', toggleTheme);

    const createNewMap = async () => {
      const rec = {
        id: uid(), name: 'Neue Mindmap',
        createdAt: Date.now(), updatedAt: Date.now(),
        data: { nodes: [], edges: [], view: null },
      };
      await Store.put(rec);
      openMap(rec.id);
    };
    document.getElementById('btn-new').addEventListener('click', createNewMap);
    document.getElementById('btn-new-fab').addEventListener('click', createNewMap);

    const importInput = document.getElementById('import-file');
    document.getElementById('btn-import').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
      if (importInput.files[0]) importFile(importInput.files[0]);
      importInput.value = '';
    });

    // Datei-Modus: Map direkt aus einer Datei öffnen und darin weiterarbeiten
    const openFailed = err => {
      alert('Datei konnte nicht geöffnet werden — ist es eine gültige Mindmap-Datei?\n(' + err.message + ')');
      showHome();
    };
    const openInput = document.getElementById('open-file');
    document.getElementById('btn-open-file').addEventListener('click', async () => {
      if (window.showOpenFilePicker) {
        let handle;
        try {
          [handle] = await showOpenFilePicker({
            types: [{ description: 'Mindmap-Datei', accept: { 'application/json': ['.json'] } }],
          });
        } catch (_) { return; /* Dialog abgebrochen */ }
        showView('editor');
        Editor.openFile({ handle }).catch(openFailed);
      } else {
        openInput.click();
      }
    });
    openInput.addEventListener('change', () => {
      const f = openInput.files[0];
      openInput.value = '';
      if (!f) return;
      showView('editor');
      Editor.openFile({ file: f }).catch(openFailed);
    });

    // PWA: Service Worker (nur auf sicheren Origins — HTTPS oder localhost)
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Speicher-Backend erkennen: Server-API oder lokale IndexedDB
    let res = await initStore();
    let firstTry = true;
    while (res.mode === 'unauthorized') {
      const key = await askKey(!firstTry);
      firstTry = false;
      localStorage.setItem('mm-key', key);
      res = await initStore();
    }
    Store = res.store;

    Editor.init();
    showHome();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showHome, exportMap, downloadJson };
})();
