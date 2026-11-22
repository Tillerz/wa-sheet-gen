// WA Sheet Generator — editor UI. Plain JavaScript, no libraries.
import { createEditor } from './editor.js';
import * as T from './tree.js';
import { buildFormat, canFormat, fmtKeyFor } from './formatpanel.js';

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
  rules: { bannedWords: [], sheetNameRe: /^$/, classNameRe: /^$/, fieldNameRe: /^$/, forbiddenPrefixes: [], colorRe: /^$/, fontNameRe: /^$/, fontURLRe: /^$/ },
  formatClasses: {}, // node id → f-N, from /api/preview
  themes: [], // from /api/themes
};

async function api(method, path, body) {
  const opts = { method, headers: { 'X-Token': token } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.data = data;
    throw err;
  }
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

// ---------- undo / redo ----------

// undoHistory keeps JSON snapshots of the project. Quick typing in the panel is grouped
// into one step; canvas changes (drop, delete, …) are one step each.
const undoHistory = { undo: [], redo: [], current: '', saved: '', timer: null };
const historyLimit = 200;

function snapshot() {
  return JSON.stringify(state.project);
}

function updateDirty() {
  state.dirty = snapshot() !== undoHistory.saved;
  updateTitle();
  scheduleAutosave();
}

// ---------- autosave: unsaved work survives a reload or a crash ----------

let autosaveTimer;

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const req = state.dirty
      ? api('PUT', '/api/autosave', { project: state.project, folder: state.folder, at: Date.now() })
      : api('DELETE', '/api/autosave');
    req.catch(() => {});
  }, 800);
}

// restoreAutosave offers unsaved work from the last session. Returns true if restored.
async function restoreAutosave() {
  let saved;
  try {
    saved = await api('GET', '/api/autosave');
  } catch {
    return false;
  }
  if (!saved || !saved.project || !saved.project.root) return false;
  const when = saved.at ? new Date(saved.at).toLocaleString() : 'an earlier session';
  const name = saved.folder ? baseName(saved.folder) : saved.project.sheetName;
  if (!confirm(`There are unsaved changes of "${name}" from ${when}.\n\nRestore them?`)) {
    api('DELETE', '/api/autosave').catch(() => {});
    return false;
  }
  setProject(saved.project, saved.folder || '');
  // The restored work is not saved yet: keep it marked as unsaved.
  undoHistory.saved = '';
  updateDirty();
  toast('Unsaved changes restored.');
  return true;
}

function updateUndoButtons() {
  $('btnUndo').disabled = !undoHistory.undo.length && !undoHistory.timer;
  $('btnRedo').disabled = !undoHistory.redo.length;
}

function historyReset() {
  clearTimeout(undoHistory.timer);
  undoHistory.timer = null;
  undoHistory.undo = [];
  undoHistory.redo = [];
  undoHistory.current = undoHistory.saved = snapshot();
  updateDirty();
  updateUndoButtons();
}

// historyRecord stores the state before the latest changes as one undo step.
function historyRecord() {
  clearTimeout(undoHistory.timer);
  undoHistory.timer = null;
  const now = snapshot();
  if (now !== undoHistory.current) {
    undoHistory.undo.push(undoHistory.current);
    if (undoHistory.undo.length > historyLimit) undoHistory.undo.shift();
    undoHistory.redo = [];
    undoHistory.current = now;
  }
  updateUndoButtons();
}

// noteChange is called after every change to the project.
function noteChange(immediate) {
  if (immediate) {
    historyRecord();
  } else {
    clearTimeout(undoHistory.timer);
    undoHistory.timer = setTimeout(historyRecord, 600);
    updateUndoButtons();
  }
  updateDirty();
  refreshPreview();
}

function restore(json) {
  const sel = editor.selectedId;
  state.project = JSON.parse(json);
  $('sheetName').value = state.project.sheetName;
  checkSheetName();
  renderSheetExtras();
  editor.render();
  editor.select(sel);
  updateDirty();
  updateUndoButtons();
  refreshPreview();
}

function undo() {
  historyRecord();
  if (!undoHistory.undo.length) return;
  undoHistory.redo.push(undoHistory.current);
  undoHistory.current = undoHistory.undo.pop();
  restore(undoHistory.current);
}

function redo() {
  historyRecord();
  if (!undoHistory.redo.length) return;
  undoHistory.undo.push(undoHistory.current);
  undoHistory.current = undoHistory.redo.pop();
  restore(undoHistory.current);
}

function isTyping(target) {
  return !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

// Keyboard shortcuts. They work in the app and in the canvas, but not while typing.
function onShortcut(e) {
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  // Saving also works while typing in a field.
  if (ctrl && k === 's') {
    e.preventDefault();
    if (e.shiftKey) doSaveAs();
    else doSave();
    return;
  }
  if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
  const sel = editor.selectedId;
  const layout = editor.mode === 'layout';
  if (ctrl && k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (ctrl && k === 'd' && sel && layout) {
    e.preventDefault();
    const n = T.find(state.project.root, sel);
    if (n && n.parent && !['card-header', 'card-body'].includes(n.node.type)) editor.duplicate(sel);
  } else if (!ctrl && k === 'delete' && sel && layout) {
    e.preventDefault();
    if (T.canRemove(state.project.root, sel)) editor.remove(sel);
    else toast('This element holds the name field and cannot be deleted.');
  } else if (!ctrl && k === 'escape') {
    editor.select(null);
  }
}

function updateTitle() {
  const name = state.folder ? baseName(state.folder) : 'Unsaved sheet';
  $('docTitle').textContent = (state.dirty ? '● ' : '') + name;
  document.title = (state.dirty ? '● ' : '') + name + ' — WA Sheet Generator';
  $('folderPath').textContent = state.folder || 'Not saved yet';
  // The Save button is only highlighted when there is something to save.
  $('btnSave').classList.toggle('primary', state.dirty);
}

function setProject(project, folder) {
  state.project = project;
  state.folder = folder;
  $('sheetName').value = project.sheetName;
  checkSheetName();
  historyReset();
  renderSheetExtras();
  editor.render();
  editor.select(null);
  refreshPreview();
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
  onChange: () => noteChange(true),
  onSelect: (node, part) => {
    // A click on a field's label or value opens that look in the format panel.
    if (part === 'label') ui.look = 'fmtLabel';
    else if (part === 'value') ui.look = 'fmt';
    renderSelection(node);
  },
  openMenu,
  setFieldLabel,
  getFormatClass: (id) => state.formatClasses[id] || '',
  openFormat: (node) => {
    editor.select(node.id);
    const sec = $('fmtSection');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
});

// ---------- canvas preview: sheet CSS and canvas theme ----------

// The canvas shows the real sheet CSS, made by the same Go code as the export.
let previewTimer;
let previewCss = '';

function refreshPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 120);
}

async function runPreview() {
  if (!state.project) return;
  if (editor.editing) {
    refreshPreview();
    return;
  }
  try {
    const res = await api('POST', '/api/preview', { project: state.project });
    const classes = res.classes || {};
    const classesChanged = JSON.stringify(classes) !== JSON.stringify(state.formatClasses);
    state.formatClasses = classes;
    previewCss = res.css || '';
    applyCanvasCss();
    editor.setPreviewHtml({ sheet: res.sheetHtml || '', form: res.formHtml || '' });
    if (classesChanged && !editor.editing) editor.render();
  } catch {
    // The preview is only cosmetic; Check and Export report real problems.
  }
}

function canvasDocument() {
  const doc = $('canvas').contentDocument;
  return doc && doc.getElementById('sheet') ? doc : null;
}

function applyCanvasCss() {
  const doc = canvasDocument();
  if (!doc) return;
  let st = doc.getElementById('sheet-css');
  if (!st) {
    st = doc.createElement('style');
    st.id = 'sheet-css';
    doc.head.append(st);
  }
  st.textContent = previewCss;
}

const ui = {
  look: 'fmt', // active field look in the format panel
  canvasTheme: 'dark',
  outlines: true,
};

// ---------- settings (stored by the server in a file, see settings.go) ----------

const settings = { recent: [], lastFolder: '', canvasTheme: 'dark', outlines: true };
let settingsTimer;

function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => api('PUT', '/api/settings', settings).catch(() => {}), 300);
}

async function loadSettings() {
  try {
    Object.assign(settings, await api('GET', '/api/settings'));
  } catch {
    // Defaults are fine.
  }
  ui.canvasTheme = settings.canvasTheme === 'light' ? 'light' : 'dark';
  ui.outlines = settings.outlines !== false;
  applyCanvasTheme();
  for (const s of splitters) s.apply();
}

// ---------- resizable sidebars ----------

// makeSplitter lets the user drag the edge of a sidebar. The width is kept in the settings.
function makeSplitter(handle, pane, side, key, def, min, max) {
  const clamp = (w) => Math.max(min, Math.min(max, Math.round(w)));
  const set = (w) => { pane.style.width = `${clamp(w)}px`; };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    document.body.classList.add('resizing');
    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    const move = (ev) => set(startW + (side === 'left' ? ev.clientX - startX : startX - ev.clientX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('active');
      document.body.classList.remove('resizing');
      settings[key] = clamp(pane.getBoundingClientRect().width);
      saveSettings();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => {
    set(def);
    delete settings[key];
    saveSettings();
  });
  return { apply: () => set(Number(settings[key]) || def) };
}

const splitters = [
  makeSplitter($('splitLeft'), $('palette'), 'left', 'paletteWidth', 180, 140, 400),
  makeSplitter($('splitRight'), $('sidePanel'), 'right', 'panelWidth', 300, 240, 700),
];

// addRecent puts folder first in the recent list (at most 8 entries).
function addRecent(folder) {
  settings.recent = [folder, ...(settings.recent || []).filter((f) => f !== folder)].slice(0, 8);
  saveSettings();
}

function applyCanvasTheme() {
  const doc = canvasDocument();
  if (doc) {
    doc.body.classList.toggle('dark', ui.canvasTheme === 'dark');
    doc.body.classList.toggle('clean', !ui.outlines);
  }
  $('btnOutlines').classList.toggle('active', ui.outlines);
  $('btnTheme').textContent = ui.canvasTheme === 'dark' ? '☾ Dark' : '☀ Light';
  $('canvas').classList.toggle('dark', ui.canvasTheme === 'dark');
}

$('btnOutlines').onclick = () => {
  ui.outlines = !ui.outlines;
  settings.outlines = ui.outlines;
  saveSettings();
  applyCanvasTheme();
};

// View switch: Layout (editing) or the read-only Sheet and Form previews with sample data.
document.querySelectorAll('#viewSwitch button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#viewSwitch button').forEach((x) => x.classList.toggle('active', x === b));
    openMenu(null);
    editor.setMode(b.dataset.view);
    $('palette').classList.toggle('disabled', b.dataset.view !== 'layout');
  });
});

$('btnTheme').onclick = () => {
  ui.canvasTheme = ui.canvasTheme === 'dark' ? 'light' : 'dark';
  settings.canvasTheme = ui.canvasTheme;
  saveSettings();
  applyCanvasTheme();
};

$('canvas').addEventListener('load', () => {
  applyCanvasTheme();
  applyCanvasCss();
});
applyCanvasTheme();

// ---------- formatting ----------

// setFmt stores one format value of a node; '' or false removes it.
function setFmt(node, key, prop, value) {
  const p = (node.props ||= {});
  const m = (p[key] ||= {});
  if (value === '' || value === false || value === null || value === undefined) delete m[prop];
  else m[prop] = value;
  if (!Object.keys(m).length) delete p[key];
  changed();
}

function selectedNode() {
  const id = editor.selectedId;
  return id && state.project ? (T.find(state.project.root, id) || {}).node : null;
}

// Quick buttons above the canvas: act on the selected element (for fields: the active look).
document.querySelectorAll('#quickFmt button').forEach((b) => {
  b.addEventListener('click', () => {
    const node = selectedNode();
    if (!node || !canFormat(node)) {
      toast('Select an element first.');
      return;
    }
    const key = fmtKeyFor(node, ui.look);
    const m = (node.props && node.props[key]) || {};
    const { prop, value } = b.dataset;
    if (value) setFmt(node, key, prop, m[prop] === value ? '' : value);
    else setFmt(node, key, prop, !m[prop]);
    renderSelection(node);
  });
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

// ---------- sheet settings: fonts and custom CSS ----------

function fontError(f) {
  if (!state.rules.fontNameRe.test(f.name)) return 'Name: letters, digits, spaces and - only.';
  if (!state.rules.fontURLRe.test(f.url)) return 'URL: must start with https:// and have no spaces, quotes or brackets.';
  return '';
}

// renderSheetExtras builds the font list and the custom CSS boxes. It is rebuilt only
// when the project changes as a whole (open, new, undo), so typing keeps the focus.
function renderSheetExtras() {
  const p = state.project;
  p.fonts ||= [];
  p.customCss ||= { style: '', approved: '' };

  const fontRows = p.fonts.map((f, i) => {
    const err = h('p', { class: 'error', textContent: f.name || f.url ? fontError(f) : '' });
    const check = () => { err.textContent = fontError(f); };
    const name = h('input', {
      type: 'text', value: f.name, placeholder: 'Font name, e.g. Grenze',
      oninput: () => { f.name = name.value.trim(); check(); noteChange(false); },
      onchange: () => renderSheetExtras(),
    });
    const url = h('input', {
      type: 'text', value: f.url, placeholder: 'https://…/font.woff2', spellcheck: false,
      oninput: () => { f.url = url.value.trim(); check(); noteChange(false); },
    });
    const del = h('button', {
      type: 'button', class: 'danger', textContent: 'Remove',
      onclick: () => { p.fonts.splice(i, 1); noteChange(true); renderSheetExtras(); },
    });
    return h('div', { class: 'font-row' }, name, url, h('div', { class: 'sel-actions' }, del), err);
  });
  const addFont = h('button', {
    type: 'button', textContent: 'Add font',
    onclick: () => { p.fonts.push({ name: '', url: '' }); noteChange(true); renderSheetExtras(); },
  });

  const rootFmt = (p.root.props && p.root.props.fmt) || {};
  const names = p.fonts.map((f) => f.name).filter(Boolean);
  const defSel = h('select', {
    onchange: () => setFmt(p.root, 'fmt', 'font', defSel.value),
  }, h('option', { value: '', textContent: '(WA default)' }), ...names.map((n) => h('option', { value: n, textContent: n })));
  defSel.value = names.includes(rootFmt.font) ? rootFmt.font : '';

  const cssBox = (key, label, hint) => {
    const area = h('textarea', {
      rows: 6, value: p.customCss[key] || '', spellcheck: false, class: 'code',
      oninput: () => { p.customCss[key] = area.value; noteChange(false); },
    });
    return [h('label', { class: 'field' }, h('span', { textContent: label }), area), h('p', { class: 'hint', textContent: hint })];
  };

  const themeSel = h('select', {
    onchange: () => {
      if (themeSel.value) p.theme = themeSel.value;
      else delete p.theme;
      themeHint.textContent = themeDesc();
      noteChange(true);
    },
  }, h('option', { value: '', textContent: '(none)' }), ...state.themes.map((t) => h('option', { value: t.id, textContent: t.name })));
  themeSel.value = p.theme || '';
  const themeDesc = () => {
    const t = state.themes.find((x) => x.id === themeSel.value);
    return t ? `${t.desc}. Written at the start of style.css; your formats and custom CSS override it.` : 'Colors, fonts, borders and striped rows for the whole sheet.';
  };
  const themeHint = h('p', { class: 'hint', textContent: themeDesc() });

  $('sheetExtras').replaceChildren(
    h('label', { class: 'field' }, h('span', { textContent: 'Theme' }), themeSel),
    themeHint,
    h('details', {},
      h('summary', { textContent: `Fonts (${p.fonts.length})` }),
      h('p', { class: 'hint', textContent: 'Each font needs a direct link to a font file (.woff2, .otf, …). It goes into approved.css.' }),
      ...fontRows, addFont,
      h('label', { class: 'field' }, h('span', { textContent: 'Default font of the sheet' }), defSel)),
    h('details', { open: !!(p.customCss.style || p.customCss.approved) },
      h('summary', { textContent: 'Custom CSS' }),
      ...cssBox('style', 'Extra style.css', 'Added at the end of style.css. Start selectors with .block-' + p.sheetName + '.'),
      ...cssBox('approved', 'Extra approved.css', 'For CSS the normal filter removes, e.g. gradients. Same character rules apply.')),
  );
}

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
  ul: 'Bullet list', ol: 'Numbered list', li: 'List item', table: 'Table', tr: 'Table row',
  th: 'Header cell (th)', td: 'Data cell (td)', image: 'Image', flabel: 'Field label',
};

const fieldTypeNames = {
  string: 'String', number: 'Number', text: 'Text area', checkbox: 'Checkbox',
  select: 'Dropdown', suggest: 'Suggest', image: 'Image ID',
};

function usedNamesExcept(node) {
  const used = T.fieldNames(state.project.root);
  used.delete(node.props.name);
  return used;
}

// setFieldLabel changes a field's label. While the name still follows the label,
// the name follows the new label too (if that name is valid and free).
function setFieldLabel(node, label) {
  const p = node.props;
  const auto = !p.required && p.name === T.toFieldName(p.label || '');
  p.label = label;
  if (auto) {
    const name = T.toFieldName(label);
    if (name && !T.fieldNameError(name, state.rules, usedNamesExcept(node))) p.name = name;
  }
}

function labeled(text, input) {
  return h('label', { class: 'field' }, h('span', { textContent: text }), input);
}

function fieldPanel(node, out) {
  const p = node.props;
  const locked = !!p.required;

  const typeSel = h('select', {
    disabled: locked,
    onchange: () => {
      p.fieldType = typeSel.value;
      if (p.fieldType === 'text' && !p.rows) p.rows = 3;
      if ((p.fieldType === 'select' || p.fieldType === 'suggest') && !(p.options || []).length) {
        p.options = ['Option 1', 'Option 2'];
      }
      changed();
      renderSelection(node);
    },
  }, ...T.fieldTypes.map((t) => h('option', { value: t, textContent: fieldTypeNames[t], selected: t === p.fieldType })));
  out.push(labeled('Type', typeSel));

  const nameErr = h('p', { class: 'error' });
  const nameInput = h('input', {
    type: 'text', value: p.name, spellcheck: false, disabled: locked,
    oninput: () => {
      const v = nameInput.value.trim();
      const msg = T.fieldNameError(v, state.rules, usedNamesExcept(node));
      nameErr.textContent = msg;
      nameInput.classList.toggle('invalid', !!msg);
      if (msg) return;
      p.name = v;
      changed();
    },
  });
  const labelInput = h('input', {
    type: 'text', value: p.label || '',
    oninput: () => {
      setFieldLabel(node, labelInput.value);
      nameInput.value = p.name;
      nameErr.textContent = '';
      nameInput.classList.remove('invalid');
      changed();
    },
  });
  out.push(labeled('Label', labelInput));
  out.push(labeled('Field name', nameInput), nameErr);
  if (locked) out.push(h('p', { class: 'hint', textContent: 'The name field is required. Only its label can change.' }));

  const descInput = h('input', {
    type: 'text', value: p.description || '', placeholder: 'Same as label',
    oninput: () => {
      if (descInput.value) p.description = descInput.value;
      else delete p.description;
      noteChange(false);
    },
  });
  out.push(labeled('Description', descInput));

  if (p.fieldType === 'number') {
    const warn = h('p', { class: 'error' });
    const checkRange = () => {
      warn.textContent = p.min !== undefined && p.max !== undefined && p.min > p.max ? 'Min is greater than max.' : '';
    };
    for (const key of ['min', 'max']) {
      const input = h('input', {
        type: 'number', value: p[key] ?? '', placeholder: 'none',
        oninput: () => {
          if (input.value === '' || Number.isNaN(Number(input.value))) delete p[key];
          else p[key] = Number(input.value);
          checkRange();
          noteChange(false);
        },
      });
      out.push(labeled(key === 'min' ? 'Min' : 'Max', input));
    }
    out.push(warn);
    checkRange();
  }

  if (p.fieldType === 'text') {
    const input = h('input', {
      type: 'number', min: 1, max: 20, value: p.rows ?? 3,
      oninput: () => {
        const v = Math.round(Number(input.value));
        if (v >= 1 && v <= 20) {
          p.rows = v;
          noteChange(false);
        }
      },
    });
    out.push(labeled('Rows', input));
  }

  if (p.fieldType === 'select' || p.fieldType === 'suggest') {
    const area = h('textarea', {
      rows: 6, value: (p.options || []).join('\n'),
      oninput: () => {
        p.options = [...new Set(area.value.split('\n').map((x) => x.trim()).filter(Boolean))];
        changed();
      },
    });
    out.push(labeled('Values (one per line)', area));
  }

  if (['string', 'number', 'text', 'suggest', 'image'].includes(p.fieldType)) {
    const ph = h('input', {
      type: 'text', value: p.placeholder || '',
      placeholder: p.fieldType === 'image' ? 'WA Image ID' : 'Shown in the empty input',
      oninput: () => {
        if (ph.value) p.placeholder = ph.value;
        else delete p.placeholder;
        changed();
      },
    });
    out.push(labeled('Placeholder', ph));
  }

  const parent = T.find(state.project.root, node.id).parent;
  const list = T.listOf(state.project.root, node.id);
  if (list) {
    const r = T.repeatCount(list);
    out.push(h('p', { class: 'hint', textContent: `In a list: on WA this field is ${p.name}_001 … ${p.name}_${String(r).padStart(3, '0')}.` }));
  }
  if (T.isCell(parent)) {
    out.push(h('p', { class: 'hint', textContent: T.labelMode(state.project.root, node.id) === 'top'
      ? 'In a table cell the field shows only its input; its label sits in the header row above it.'
      : 'In a table cell the field shows only its input; its label sits in the label cell (th) before it.' }));
  }
  out.push(h('p', { class: 'hint', textContent: 'Tip: double-click the label in the sheet to edit it.' }));
}

const colWidthKeys = [
  ['col', 'Small and up', 'col-x'],
  ['md', 'Medium and up', 'col-md-x'],
  ['lg', 'Large and up', 'col-lg-x'],
];

function changed() {
  noteChange(false);
  editor.render();
}

// breadcrumb shows the path from the sheet root to node. Each part selects that element,
// e.g. a table, which its cells cover completely in the canvas.
function breadcrumb(node) {
  const path = [];
  for (let n = T.find(state.project.root, node.id); n; n = n.parent ? T.find(state.project.root, n.parent.id) : null) {
    path.unshift(n.node);
  }
  const parts = [];
  path.forEach((p, i) => {
    if (i) parts.push(h('span', { class: 'crumb-sep', textContent: '›' }));
    const name = p.type === 'container' ? 'Sheet' : typeNames[p.type] || p.type;
    parts.push(p === node
      ? h('span', { class: 'crumb current', textContent: name })
      : h('button', { type: 'button', class: 'crumb', textContent: name, title: 'Select this ' + name.toLowerCase(), onclick: () => editor.select(p.id) }));
  });
  return h('div', { class: 'crumbs' }, ...parts);
}

function renderSelection(node) {
  const box = $('selection');
  if (!node) {
    box.replaceChildren(h('p', { class: 'hint', textContent: 'Click an element in the sheet to select it.' }));
    return;
  }
  const out = [breadcrumb(node), h('div', { class: 'sel-type', textContent: typeNames[node.type] || node.type })];
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

  if (node.type === 'field') fieldPanel(node, out);

  if (node.type === 'text') {
    const input = h('input', {
      type: 'text', value: p.text || '',
      oninput: () => {
        p.text = input.value;
        changed();
      },
    });
    out.push(labeled('Text', input));
    out.push(h('p', { class: 'hint', textContent: 'Tip: double-click a text in the sheet to edit it there.' }));
  }

  if (node.type === 'image') {
    const err = h('p', { class: 'error' });
    const idInput = h('input', {
      type: 'text', value: p.imageId || '', placeholder: 'e.g. 7978043', inputMode: 'numeric',
      oninput: () => {
        const v = idInput.value.trim();
        const bad = !/^\d*$/.test(v);
        err.textContent = bad ? 'Use digits only.' : '';
        idInput.classList.toggle('invalid', bad);
        if (bad) return;
        p.imageId = v;
        changed();
      },
    });
    const wInput = h('input', {
      type: 'number', min: 1, value: p.width ?? '', placeholder: 'natural size',
      oninput: () => {
        const v = Math.round(Number(wInput.value));
        if (wInput.value === '' || !(v > 0)) delete p.width;
        else p.width = v;
        changed();
      },
    });
    out.push(labeled('WA image ID', idInput), err, labeled('Width (px)', wInput));
    out.push(h('p', { class: 'hint', textContent: 'Upload the image to WA. The ID is the number in its URL.' }));
  }

  if (node.type === 'flabel') {
    const f = T.find(state.project.root, p.field);
    out.push(h('p', { class: 'hint', textContent: f
      ? `Shows the label of the field "${f.node.props.name}". Edit or format it there (Label look).`
      : 'Its field no longer exists. Delete this label.' }));
    if (f) out.push(h('div', { class: 'sel-actions' }, h('button', { type: 'button', textContent: 'Select field', onclick: () => editor.select(f.node.id, 'label') })));
  }

  if (node.type === 'table') {
    const mode = T.labelMode(state.project.root, node.id);
    out.push(labeled('Field labels', h('div', { class: 'segmented' },
      ...[['left', 'Left of each field'], ['top', 'On top']].map(([m, text]) => h('button', {
        type: 'button', textContent: text, class: m === mode ? 'active' : '',
        onclick: () => {
          T.setLabelMode(state.project.root, node.id, m);
          noteChange(true);
          editor.render();
          renderSelection(node);
        },
      })))));
    out.push(h('p', { class: 'hint', textContent: mode === 'top'
      ? 'A field takes one cell; its label goes into the header row (first row) above it, if that cell is empty.'
      : 'A field takes two cells: its label in a th, its input in the next td.' }));
  }

  if (['table', 'tr', 'th', 'td'].includes(node.type)) {
    out.push(h('p', { class: 'hint', textContent: 'Right-click for rows, columns and cell type. Double-click an empty cell to type text.' }));
  }
  if (['ul', 'ol', 'li'].includes(node.type)) {
    out.push(h('p', { class: 'hint', textContent: 'Right-click to add items. Double-click an empty item to type text. Fields can go into items.' }));
  }

  // List: for the element itself, or for the row, col, card, … around it.
  const target = T.repeatTarget(state.project.root, node.id);
  if (target) {
    const problem = T.listProblem(state.project.root, target);
    const r = T.repeatCount(target);
    const what = T.repeatNames[target.type];
    const input = h('input', {
      type: 'number', min: 1, max: 99, value: r > 1 ? r : '', placeholder: 'no list',
      disabled: !!problem && r < 2,
      oninput: () => {
        const v = Number(input.value);
        if (input.value === '' || (v >= 1 && v <= 99)) {
          T.setRepeat(target, input.value);
          changed();
        }
      },
    });
    out.push(h('h3', { class: 'sub', textContent: 'List' }));
    out.push(labeled(target === node ? 'Repeat (entries)' : `Repeat the ${what} around it (entries)`, input));
    if (target !== node) {
      out.push(h('div', { class: 'sel-actions' }, h('button', { type: 'button', textContent: `Select the ${what}`, onclick: () => editor.select(target.id) })));
    }
    out.push(h('p', { class: 'hint', textContent: problem && r < 2
      ? `The ${what} cannot repeat: ${problem}`
      : 'Exported once inside a Twig loop. Fields inside get _001, _002, … on WA. Empty = no list.' }));
  }

  if (canFormat(node)) {
    const fonts = (state.project.fonts || []).map((f) => f.name).filter(Boolean);
    out.push(h('h3', { class: 'sub', id: 'fmtSection', textContent: 'Format' }));
    out.push(...buildFormat({
      node,
      look: ui.look,
      setLook: (look) => { ui.look = look; renderSelection(node); },
      rules: state.rules,
      fonts,
      set: (key, prop, value) => setFmt(node, key, prop, value),
      refresh: () => renderSelection(node),
      inherited: editor.inherited(node.id, node.type === 'field' ? ui.look : 'fmt'),
    }));
  }

  const root = state.project.root;
  const actions = h('div', { class: 'sel-actions' });
  if (node.id !== root.id && !['card-header', 'card-body'].includes(node.type)) {
    actions.append(h('button', { type: 'button', textContent: 'Duplicate', onclick: () => editor.duplicate(node.id) }));
  }
  if (node.id !== root.id) {
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
    if (settings.lastFolder !== listing.path) {
      settings.lastFolder = listing.path;
      saveSettings();
    }
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
  renderRecent();
  dlgLoad(state.folder || settings.lastFolder || '');
  return new Promise((resolve) => { dlg.resolve = resolve; });
}

// renderRecent shows the recently opened or saved sheets. A click goes to that folder.
function renderRecent() {
  const items = (settings.recent || []).map((folder) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'recent-item';
    b.title = folder;
    const name = document.createElement('strong');
    name.textContent = baseName(folder);
    const path = document.createElement('span');
    path.textContent = folder;
    b.append(name, path);
    b.onclick = () => dlgLoad(folder);
    b.ondblclick = () => {
      if (dlg.mode === 'open') dlgLoad(folder).then(() => dlg.listing && dlg.listing.hasProject && dlgClose(folder));
    };
    return b;
  });
  $('dlgRecentWrap').hidden = !items.length;
  $('dlgRecent').replaceChildren(...items);
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
    addRecent(folder);
    toast('Opened ' + baseName(folder));
  } catch (e) {
    toast(e.message, true);
  }
}

// saveTo saves the project into folder. Returns true on success.
async function saveTo(folder, quiet = false) {
  if (!checkSheetName()) {
    toast('Fix the sheet name first.', true);
    return false;
  }
  try {
    historyRecord();
    await api('POST', '/api/project/save', { folder, project: state.project });
    state.folder = folder;
    addRecent(folder);
    undoHistory.saved = snapshot();
    updateDirty();
    if (!quiet) toast('Saved');
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

async function doSave() {
  if (!state.folder) return doSaveAs();
  return saveTo(state.folder);
}

async function doSaveAs(quiet = false) {
  const folder = await pickFolder('save');
  return folder ? saveTo(folder, quiet) : false;
}

// ---------- check and export ----------

function showProblems(title, problems) {
  $('probTitle').textContent = title;
  const order = { error: 0, warning: 1 };
  const items = [...problems].sort((a, b) => order[a.level] - order[b.level]).map((p) => {
    const li = document.createElement('li');
    li.className = p.level;
    const icon = document.createElement('span');
    icon.className = 'prob-icon';
    icon.textContent = p.level === 'error' ? '✖' : '!';
    const msg = document.createElement('span');
    msg.textContent = p.message;
    li.append(icon, msg);
    if (p.nodeId) {
      li.classList.add('link');
      li.title = 'Show in the sheet';
      li.onclick = () => {
        $('probDlg').close();
        editor.select(p.nodeId);
      };
    }
    return li;
  });
  $('probList').replaceChildren(...items);
  $('probDlg').showModal();
}

function countLevel(problems, level) {
  return problems.filter((p) => p.level === level).length;
}

async function doCheck() {
  historyRecord();
  try {
    const { problems } = await api('POST', '/api/check', { project: state.project });
    if (!problems.length) toast('No problems found.');
    else showProblems(`${countLevel(problems, 'error')} errors, ${countLevel(problems, 'warning')} warnings`, problems);
  } catch (e) {
    toast(e.message, true);
  }
}

// doExport checks the sheet, saves it, then writes the five WA files into the project folder.
async function doExport() {
  historyRecord();
  try {
    const { problems } = await api('POST', '/api/check', { project: state.project });
    if (countLevel(problems, 'error')) {
      showProblems(`Export stopped: ${countLevel(problems, 'error')} errors`, problems);
      return;
    }
    const saved = state.folder ? await saveTo(state.folder, true) : await doSaveAs(true);
    if (!saved) return;
    const res = await api('POST', '/api/export', { folder: state.folder, project: state.project });
    if (res.problems.length) {
      showProblems(`Exported ${res.files.length} files, with ${res.problems.length} warnings`, res.problems);
    } else {
      toast(`Exported ${res.files.length} files to ${baseName(state.folder)}`);
    }
  } catch (e) {
    if (e.data && e.data.problems) showProblems('Export stopped', e.data.problems);
    else toast(e.message, true);
  }
}

$('btnCheck').onclick = doCheck;
$('btnExport').onclick = doExport;
$('probClose').onclick = () => $('probDlg').close();

$('btnNew').onclick = doNew;
$('btnOpen').onclick = doOpen;
$('btnSave').onclick = () => doSave();
$('btnSaveAs').onclick = () => doSaveAs();

$('sheetName').addEventListener('input', () => {
  state.project.sheetName = $('sheetName').value;
  checkSheetName();
  noteChange(false);
  editor.render();
});

$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
document.addEventListener('keydown', onShortcut);
// The canvas is its own document: listen there too.
$('canvas').addEventListener('load', () => $('canvas').contentDocument.addEventListener('keydown', onShortcut));
if ($('canvas').contentDocument) $('canvas').contentDocument.addEventListener('keydown', onShortcut);

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
      fieldNameRe: new RegExp(rules.fieldNamePattern),
      forbiddenPrefixes: rules.forbiddenPrefixes,
      colorRe: new RegExp(rules.colorPattern),
      fontNameRe: new RegExp(rules.fontNamePattern),
      fontURLRe: new RegExp(rules.fontURLPattern),
    };
    await loadSettings();
    state.themes = await api('GET', '/api/themes');
    const info = await api('GET', '/api/info');
    $('appVersion').textContent = 'v' + info.version;
    if (!(await restoreAutosave())) setProject(await api('GET', '/api/project/new'), '');
  } catch (e) {
    toast(e.message, true);
  }
}

start();
