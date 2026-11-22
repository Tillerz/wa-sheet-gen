// WA Sheet Generator — editor UI. Plain JavaScript, no libraries.

const $ = (id) => document.getElementById(id);

// The start URL carries the API token. Keep it for reloads, then hide it.
const params = new URLSearchParams(location.search);
let token = params.get('t');
if (token) {
  sessionStorage.setItem('token', token);
  history.replaceState(null, '', '/');
} else {
  token = sessionStorage.getItem('token') || '';
}

const state = {
  project: null,
  folder: '',
  dirty: false,
  rules: { bannedWords: [], sheetNameRe: /^$/ },
};

async function api(method, path, body) {
  const opts = { method, headers: { 'X-Token': token } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

// ---------- toast ----------

let toastTimer;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2500);
}

// ---------- project state ----------

function baseName(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function setDirty(dirty) {
  state.dirty = dirty;
  updateTitle();
}

function updateTitle() {
  const name = state.folder ? baseName(state.folder) : 'Unsaved sheet';
  $('docTitle').textContent = (state.dirty ? '● ' : '') + name;
  document.title = (state.dirty ? '● ' : '') + name + ' — WA Sheet Generator';
  $('folderPath').textContent = state.folder || 'Not saved yet';
}

function setProject(project, folder) {
  state.project = project;
  state.folder = folder;
  $('sheetName').value = project.sheetName;
  checkSheetName();
  setDirty(false);
  renderCanvas();
}

function sheetNameError(name) {
  if (!state.rules.sheetNameRe.test(name)) return 'Use only a-z, 0-9 and single - between words.';
  const lower = name.toLowerCase();
  const bad = state.rules.bannedWords.find((w) => lower.includes(w));
  if (bad) return `Contains "${bad}", which the WA filter removes.`;
  return '';
}

function checkSheetName() {
  const name = $('sheetName').value;
  const err = sheetNameError(name);
  $('sheetNameErr').textContent = err;
  $('sheetName').classList.toggle('invalid', !!err);
  $('rootClass').textContent = `container-fluid block-${name}`;
  return !err;
}

function confirmDiscard() {
  return !state.dirty || confirm('You have unsaved changes. Discard them?');
}

// ---------- canvas ----------

function canvasDoc() {
  const doc = $('canvas').contentDocument;
  return doc && doc.getElementById('sheet') ? doc : null;
}

function colClasses(props = {}) {
  const cls = [];
  if (props.col) cls.push(`col-${props.col}`);
  if (props.md) cls.push(`col-md-${props.md}`);
  if (props.lg) cls.push(`col-lg-${props.lg}`);
  return cls.length ? cls : ['col'];
}

// renderNode builds DOM with textContent only, so user text can never become HTML.
function renderNode(doc, node) {
  const el = doc.createElement('div');
  el.dataset.id = node.id;
  const p = node.props || {};
  switch (node.type) {
    case 'container':
      el.className = `container-fluid block-${state.project.sheetName}`;
      break;
    case 'row':
      el.className = 'row';
      break;
    case 'col':
      el.className = colClasses(p).join(' ');
      break;
    case 'field': {
      const cls = String(p.name || '').replaceAll('_', '-');
      const lbl = doc.createElement('div');
      lbl.className = `lbl lbl-${cls}`;
      lbl.textContent = p.label || p.name;
      const val = doc.createElement('div');
      val.className = `var var-${cls}`;
      el.append(lbl, val);
      return el;
    }
    default:
      el.textContent = `[${node.type}]`;
  }
  for (const child of node.children || []) el.append(renderNode(doc, child));
  return el;
}

function renderCanvas() {
  const doc = canvasDoc();
  if (!doc || !state.project) return;
  doc.getElementById('sheet').replaceChildren(renderNode(doc, state.project.root));
}

// ---------- folder dialog ----------

const dlg = {
  mode: 'open',
  listing: null,
  resolve: null,
};

const badFolderChars = /[\\/:*?"<>|]/;

function joinPath(dir, name) {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

async function dlgLoad(path) {
  try {
    const listing = await api('GET', '/api/fs/list?path=' + encodeURIComponent(path || ''));
    dlg.listing = listing;
    localStorage.setItem('lastFolder', listing.path);
    $('dlgPath').value = listing.path;
    $('dlgUp').disabled = !listing.parent;

    $('dlgDrives').replaceChildren(...(listing.drives || []).map((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d;
      b.onclick = () => dlgLoad(d);
      return b;
    }));

    const items = listing.dirs.map((d) => {
      const li = document.createElement('li');
      li.textContent = d.name;
      li.title = d.path;
      if (d.hasProject) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'sheet';
        li.append(badge);
      }
      li.onclick = () => dlgLoad(d.path);
      return li;
    });
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No subfolders';
      items.push(li);
    }
    $('dlgList').replaceChildren(...items);
    dlgUpdate();
  } catch (e) {
    toast(e.message, true);
  }
}

function dlgTarget() {
  const name = $('dlgNew').value.trim();
  return name ? joinPath(dlg.listing.path, name) : dlg.listing.path;
}

function dlgUpdate() {
  const l = dlg.listing;
  if (!l) return;
  if (dlg.mode === 'open') {
    $('dlgOk').disabled = !l.hasProject;
    $('dlgHint').textContent = l.hasProject
      ? 'This folder holds a sheet.'
      : 'Go into a folder marked "sheet".';
    return;
  }
  const name = $('dlgNew').value.trim();
  if (name && badFolderChars.test(name)) {
    $('dlgOk').disabled = true;
    $('dlgHint').textContent = 'A folder name cannot contain \\ / : * ? " < > |';
    return;
  }
  $('dlgOk').disabled = false;
  $('dlgHint').textContent = 'Saves to: ' + joinPath(dlgTarget(), 'project.json');
}

function dlgTargetHasProject() {
  const name = $('dlgNew').value.trim();
  if (!name) return dlg.listing.hasProject;
  const d = dlg.listing.dirs.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return !!(d && d.hasProject);
}

function pickFolder(mode) {
  dlg.mode = mode;
  dlg.listing = null;
  $('dlgOk').disabled = true;
  $('dlgTitle').textContent = mode === 'open' ? 'Open sheet' : 'Save sheet as';
  $('dlgOk').textContent = mode === 'open' ? 'Open' : 'Save here';
  $('dlgNewWrap').hidden = mode === 'open';
  $('dlgNew').value = mode === 'save' && !state.folder ? state.project.sheetName : '';
  $('folderDlg').showModal();
  dlgLoad(state.folder || localStorage.getItem('lastFolder') || '');
  return new Promise((resolve) => { dlg.resolve = resolve; });
}

function dlgClose(result) {
  $('folderDlg').close();
  const r = dlg.resolve;
  dlg.resolve = null;
  if (r) r(result);
}

$('dlgUp').onclick = () => dlg.listing && dlg.listing.parent && dlgLoad(dlg.listing.parent);
$('dlgPath').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    dlgLoad($('dlgPath').value);
  }
});
$('dlgNew').addEventListener('input', dlgUpdate);
$('dlgCancel').onclick = () => dlgClose(null);
$('folderDlg').addEventListener('cancel', (e) => {
  e.preventDefault();
  dlgClose(null);
});
$('dlgOk').onclick = () => {
  if (dlg.mode === 'save' && dlgTargetHasProject()
      && !confirm('This folder already holds a sheet. Replace its project.json?')) return;
  dlgClose(dlgTarget());
};

// ---------- actions ----------

async function doNew() {
  if (!confirmDiscard()) return;
  try {
    setProject(await api('GET', '/api/project/new'), '');
  } catch (e) {
    toast(e.message, true);
  }
}

async function doOpen() {
  if (!confirmDiscard()) return;
  const folder = await pickFolder('open');
  if (!folder) return;
  try {
    setProject(await api('POST', '/api/project/open', { folder }), folder);
    toast('Opened ' + baseName(folder));
  } catch (e) {
    toast(e.message, true);
  }
}

async function saveTo(folder) {
  if (!checkSheetName()) {
    toast('Fix the sheet name first.', true);
    return;
  }
  try {
    await api('POST', '/api/project/save', { folder, project: state.project });
    state.folder = folder;
    setDirty(false);
    toast('Saved');
  } catch (e) {
    toast(e.message, true);
  }
}

async function doSave() {
  if (!state.folder) return doSaveAs();
  return saveTo(state.folder);
}

async function doSaveAs() {
  const folder = await pickFolder('save');
  if (folder) await saveTo(folder);
}

$('btnNew').onclick = doNew;
$('btnOpen').onclick = doOpen;
$('btnSave').onclick = doSave;
$('btnSaveAs').onclick = doSaveAs;

$('sheetName').addEventListener('input', () => {
  state.project.sheetName = $('sheetName').value;
  checkSheetName();
  setDirty(true);
  renderCanvas();
});

$('canvas').addEventListener('load', renderCanvas);

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

// ---------- start ----------

async function start() {
  try {
    const rules = await api('GET', '/api/rules');
    state.rules = { bannedWords: rules.bannedWords, sheetNameRe: new RegExp(rules.sheetNamePattern) };
    setProject(await api('GET', '/api/project/new'), '');
  } catch (e) {
    toast(e.message, true);
  }
}

start();
