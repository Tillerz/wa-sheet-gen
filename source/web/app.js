// WA Sheet Generator — editor UI. Plain JavaScript, no libraries.
import { createEditor } from './editor.js';
import * as T from './tree.js';

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
  rules: { bannedWords: [], sheetNameRe: /^$/, classNameRe: /^$/, forbiddenPrefixes: [] },
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
  editor.render();
  editor.select(null);
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

// ---------- canvas editor ----------

const editor = createEditor({
  iframe: $('canvas'),
  getProject: () => state.project,
  onChange: () => setDirty(true),
  onSelect: renderSelection,
  openMenu,
});

// Palette: drag new elements into the canvas.
document.querySelectorAll('.palette-item').forEach((el) => {
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', el.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
    editor.startNewDrag(el.dataset.type);
  });
  el.addEventListener('dragend', () => editor.endDrag());
});

// Breakpoint switch: canvas width and which col width the resize handle changes.
document.querySelectorAll('#bpSwitch button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#bpSwitch button').forEach((x) => x.classList.toggle('active', x === b));
    editor.setBreakpoint(b.dataset.bp);
  });
});

// ---------- context menu ----------

function openMenu(items, x, y) {
  const m = $('ctxMenu');
  if (!items) {
    m.hidden = true;
    return;
  }
  m.replaceChildren(...items.map((it) => {
    if (it === null) return document.createElement('hr');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    b.disabled = !!it.disabled;
    if (it.danger) b.classList.add('danger');
    b.addEventListener('click', () => {
      m.hidden = true;
      it.action();
    });
    return b;
  }));
  m.hidden = false;
  m.style.left = `${Math.min(x, innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - m.offsetHeight - 8)}px`;
}

document.addEventListener('mousedown', (e) => {
  if (!$('ctxMenu').contains(e.target)) openMenu(null);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openMenu(null);
});

// ---------- properties panel ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el[k] = v;
  }
  el.append(...children);
  return el;
}

function classNameError(name) {
  const r = state.rules;
  if (!r.classNameRe.test(name)) return 'Start with a-z, then use only a-z, 0-9 and single - between words.';
  const prefix = r.forbiddenPrefixes.find((p) => name.startsWith(p));
  if (prefix) return `Must not start with "${prefix}".`;
  const bad = r.bannedWords.find((w) => name.includes(w));
  if (bad) return `Contains "${bad}", which the WA filter removes.`;
  return '';
}

const typeNames = {
  container: 'Sheet root', row: 'Row', col: 'Col', card: 'Card',
  'card-header': 'Card header', 'card-body': 'Card body', field: 'Field', text: 'Text',
};

const colWidthKeys = [
  ['col', 'All sizes', 'col-x'],
  ['md', 'Medium and up', 'col-md-x'],
  ['lg', 'Large and up', 'col-lg-x'],
];

function changed() {
  setDirty(true);
  editor.render();
}

function renderSelection(node) {
  const box = $('selection');
  if (!node) {
    box.replaceChildren(h('p', { class: 'hint', textContent: 'Click an element in the sheet to select it.' }));
    return;
  }
  const out = [h('div', { class: 'sel-type', textContent: typeNames[node.type] || node.type })];
  const p = (node.props ||= {});

  if (node.type === 'col') {
    for (const [key, label, cls] of colWidthKeys) {
      const input = h('input', {
        type: 'number', min: 1, max: 12, placeholder: 'unset', value: p[key] ?? '',
        oninput: () => {
          T.setColWidth(node, key, input.value === '' ? null : input.value);
          changed();
        },
        onchange: () => { input.value = node.props[key] ?? ''; },
      });
      out.push(h('label', { class: 'field' }, h('span', { textContent: `${label} (${cls})` }), input));
    }
    out.push(h('p', { class: 'hint', textContent: 'Values 1–12. Leave empty to unset.' }));
  }

  if (node.type === 'card') {
    const err = h('p', { class: 'error' });
    const input = h('input', {
      type: 'text', value: p.cls || '', placeholder: 'e.g. skills', spellcheck: false,
      oninput: () => {
        const v = input.value.trim();
        const msg = v ? classNameError(v) : '';
        err.textContent = msg;
        input.classList.toggle('invalid', !!msg);
        if (msg) return;
        if (v) p.cls = v;
        else delete p.cls;
        changed();
      },
    });
    out.push(h('label', { class: 'field' }, h('span', { textContent: 'Extra class' }), input), err);
  }

  if (node.type === 'field') {
    out.push(h('p', { class: 'hint', textContent: `Name: ${p.name} · Type: ${p.fieldType}` }));
    out.push(h('p', { class: 'hint', textContent: 'Field settings come in milestone 3.' }));
  }

  if (node.type === 'text') {
    out.push(h('p', { class: 'hint', textContent: `Text: ${p.text || ''}` }));
    out.push(h('p', { class: 'hint', textContent: 'Text editing comes in milestone 3.' }));
  }

  const root = state.project.root;
  const actions = h('div', { class: 'sel-actions' });
  if (node.id !== root.id && !['card-header', 'card-body', 'text'].includes(node.type)) {
    actions.append(h('button', { type: 'button', textContent: 'Duplicate', onclick: () => editor.duplicate(node.id) }));
  }
  if (node.id !== root.id && node.type !== 'text') {
    const can = T.canRemove(root, node.id);
    actions.append(h('button', {
      type: 'button', class: 'danger', textContent: 'Delete', disabled: !can,
      title: can ? '' : 'Holds the name field',
      onclick: () => editor.remove(node.id),
    }));
  }
  if (actions.children.length) out.push(actions);
  box.replaceChildren(...out);
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
  editor.render();
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

// ---------- start ----------

async function start() {
  try {
    const rules = await api('GET', '/api/rules');
    state.rules = {
      bannedWords: rules.bannedWords,
      sheetNameRe: new RegExp(rules.sheetNamePattern),
      classNameRe: new RegExp(rules.classNamePattern),
      forbiddenPrefixes: rules.forbiddenPrefixes,
    };
    setProject(await api('GET', '/api/project/new'), '');
  } catch (e) {
    toast(e.message, true);
  }
}

start();
