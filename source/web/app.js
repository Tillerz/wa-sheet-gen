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
  rules: { bannedWords: [], sheetNameRe: /^$/, classNameRe: /^$/, fieldNameRe: /^$/, forbiddenPrefixes: [] },
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
}

function restore(json) {
  const sel = editor.selectedId;
  state.project = JSON.parse(json);
  $('sheetName').value = state.project.sheetName;
  checkSheetName();
  editor.render();
  editor.select(sel);
  updateDirty();
  updateUndoButtons();
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

function onShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
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
  historyReset();
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
  onChange: () => noteChange(true),
  onSelect: renderSelection,
  openMenu,
  setFieldLabel,
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
  ul: 'Bullet list', ol: 'Numbered list', li: 'List item', table: 'Table', tr: 'Table row',
  th: 'Header cell (th)', td: 'Data cell (td)', image: 'Image',
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

  const parent = T.find(state.project.root, node.id).parent;
  if (parent && parent.type === 'tr') {
    out.push(h('p', { class: 'hint', textContent: 'In a table row this field fills two cells: label (th) and value (td).' }));
  }
  out.push(h('p', { class: 'hint', textContent: 'Tip: double-click the label in the sheet to edit it.' }));
}

const colWidthKeys = [
  ['col', 'All sizes', 'col-x'],
  ['md', 'Medium and up', 'col-md-x'],
  ['lg', 'Large and up', 'col-lg-x'],
];

function changed() {
  noteChange(false);
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

  if (['table', 'tr', 'th', 'td'].includes(node.type)) {
    out.push(h('p', { class: 'hint', textContent: 'Right-click for rows, columns and cell type. Drop a field into a row: it fills a label cell and a value cell. Double-click an empty cell to type text.' }));
  }
  if (['ul', 'ol', 'li'].includes(node.type)) {
    out.push(h('p', { class: 'hint', textContent: 'Right-click to add items. Double-click an empty item to type text. Fields can go into items.' }));
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
    };
    setProject(await api('GET', '/api/project/new'), '');
  } catch (e) {
    toast(e.message, true);
  }
}

start();
