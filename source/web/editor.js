// Canvas editor: renders the tree into the canvas iframe and handles
// selection, drag and drop, col resizing, double-click editing and the right-click menu.
import * as T from './tree.js';

const canvasWidths = { col: '420px', md: '820px', lg: '100%' };
const fixedTypes = new Set(['container', 'card-header', 'card-body']);
const tagNames = {
  flabel: 'span',
  ul: 'ul', ol: 'ol', li: 'li', table: 'table', tr: 'tr', th: 'th', td: 'td', text: 'span',
};
// Containers that get a text when you double-click them while empty.
const textHolders = new Set(['li', 'th', 'td', 'card-header']);

export function createEditor({ iframe, getProject, onChange, onSelect, openMenu, setFieldLabel, getFormatClass, openFormat }) {
  let doc = null;
  let bp = 'lg';
  let selectedId = null;
  let drag = null; // { kind: 'new', type, fieldType } or { kind: 'move', id, type }
  let indicator = null;
  let resizing = false;
  let editing = null; // { el, done }
  let mode = 'layout'; // 'layout' (editing), 'sheet' or 'form' (read-only previews)
  let previewHtml = { sheet: '', form: '' };

  const root = () => getProject().root;

  // ---------- rendering ----------

  function tagText(node) {
    const r = T.repeatCount(node);
    return baseTag(node) + (r > 1 ? ` × ${r} (list)` : '');
  }

  function baseTag(node) {
    const p = node.props || {};
    switch (node.type) {
      case 'container': return `block-${getProject().sheetName}`;
      case 'col': {
        const parts = [];
        if (p.col) parts.push(`col-${p.col}`);
        if (p.md) parts.push(`md-${p.md}`);
        if (p.lg) parts.push(`lg-${p.lg}`);
        return parts.join(' ') || 'col (auto)';
      }
      case 'card': return p.cls ? `card .${p.cls}` : 'card';
      case 'field': return `${p.fieldType} ${p.name}`;
      case 'flabel': {
        const f = T.find(root(), p.field);
        return f ? `label of ${f.node.props.name}` : 'label (field missing)';
      }
      case 'image': return `image ${p.imageId || '?'}`;
      default: return node.type;
    }
  }

  function nodeClasses(node) {
    const p = node.props || {};
    switch (node.type) {
      case 'container': return ['container-fluid', `block-${getProject().sheetName}`];
      case 'row': return ['row'];
      case 'col': return T.colClasses(p);
      case 'card': return p.cls ? ['card', p.cls] : ['card'];
      case 'card-header': return ['card-header'];
      case 'card-body': return ['card-body'];
      case 'table': return ['table'];
      default: return [];
    }
  }

  function applyClasses(el, node, extra = []) {
    const f = node.type === 'field' ? '' : getFormatClass(node.id);
    el.className = [...nodeClasses(node), ...extra, ...(f ? [f] : []), 'ed-node'].join(' ');
    if (T.repeatCount(node) > 1) el.classList.add('ed-repeat');
    if (node.id === selectedId) el.classList.add('ed-selected');
    el.dataset.tag = tagText(node);
  }

  function mark(el, node) {
    el.dataset.id = node.id;
    el.dataset.type = node.type;
    if (!fixedTypes.has(node.type)) el.draggable = true;
  }

  function placeholder(p) {
    switch (p.fieldType) {
      case 'number': return '0';
      case 'text': return 'Long text …';
      case 'checkbox': return '☐';
      case 'select': return '▾ ' + ((p.options || [])[0] || '');
      case 'suggest': return ((p.options || [])[0] || '') + ' …';
      case 'image': return '[WA image]';
      default: return 'Text';
    }
  }

  function fieldParts(node) {
    const p = node.props || {};
    const cls = String(p.name || '').replaceAll('_', '-');
    let lbl = null;
    if (String(p.label || '').trim()) {
      lbl = doc.createElement('span');
      lbl.className = `ed-label lbl lbl-${cls}`;
      lbl.textContent = p.label;
    }
    const val = doc.createElement('span');
    val.className = `ed-ph var var-${cls}`;
    val.textContent = p.placeholder || placeholder(p);
    return [lbl, val];
  }

  // renderNode builds DOM with textContent only, so user text can never become HTML.
  function renderNode(node, parentType) {
    const p = node.props || {};

    // A text directly in a col or card-body is a block (<div class='txt'>), as in the export.
    const blockText = node.type === 'text' && (parentType === 'col' || parentType === 'card-body');
    const el = doc.createElement(blockText ? 'div' : tagNames[node.type] || 'div');
    mark(el, node);
    applyClasses(el, node, blockText ? ['txt'] : []);

    switch (node.type) {
      case 'text':
        el.textContent = p.text || '';
        return el;
      case 'field': {
        const [lbl, val] = fieldParts(node);
        val.style.display = 'block';
        // In a table cell a field shows only its value; the label sits in a field label.
        if (lbl && parentType !== 'th' && parentType !== 'td') {
          lbl.style.display = 'block';
          el.append(lbl);
        }
        el.append(val);
        return el;
      }
      case 'flabel': {
        const f = T.find(root(), p.field);
        const label = f ? String(f.node.props.label || '').trim() : '';
        const span = doc.createElement('span');
        span.className = f ? `ed-label lbl lbl-${String(f.node.props.name).replaceAll('_', '-')}` : 'ed-label';
        span.textContent = label || '(no label)';
        if (!label) span.classList.add('ed-ph');
        el.append(span);
        return el;
      }
      case 'image':
        el.classList.add('ed-img');
        el.textContent = `WA image ${p.imageId || '(no ID)'}`;
        if (p.width) el.style.width = `${p.width}px`;
        return el;
      case 'table': {
        const tbody = doc.createElement('tbody');
        for (const child of node.children || []) tbody.append(renderNode(child, node.type));
        el.append(tbody);
        return el;
      }
      default:
    }
    for (const child of node.children || []) el.append(renderNode(child, node.type));
    if (node.type === 'row') {
      const free = T.rowFreeSpace(node, bp);
      if (free > 0) {
        const gap = doc.createElement('div');
        gap.className = `col-${free} ed-empty`;
        gap.textContent = (node.children || []).length ? 'empty' : 'empty row: drop a col here';
        el.append(gap);
      }
    }
    if (node.type === 'col' && bp === 'lg') {
      // Resizing changes the Large width only, so the handle is only shown there.
      const h = doc.createElement('div');
      h.className = 'ed-resize';
      h.title = 'Drag to change the width';
      el.append(h);
    }
    return el;
  }

  function render() {
    if (!doc || !getProject()) return;
    indicator = null;
    editing = null;
    doc.body.classList.toggle('preview', mode !== 'layout');
    if (mode !== 'layout') {
      // Made by the Go export code from escaped data, and checked to contain no script.
      doc.getElementById('sheet').innerHTML = previewHtml[mode];
      return;
    }
    doc.getElementById('sheet').replaceChildren(renderNode(root(), null));
    if (selectedId) elsFor(selectedId).forEach((e) => e.classList.add('ed-selected'));
  }

  function setMode(m) {
    mode = m;
    endDrag();
    render();
  }

  function setPreviewHtml(html) {
    previewHtml = html;
    if (mode !== 'layout') render();
  }

  const editable = () => mode === 'layout';

  function elsFor(id) {
    return doc ? [...doc.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)] : [];
  }

  // ---------- selection ----------

  function select(id) {
    selectedId = id && T.find(root(), id) ? id : null;
    if (doc) {
      doc.querySelectorAll('.ed-selected').forEach((e) => e.classList.remove('ed-selected'));
      if (selectedId) elsFor(selectedId).forEach((e) => e.classList.add('ed-selected'));
    }
    onSelect(selectedId ? T.find(root(), selectedId).node : null);
  }

  // ---------- breakpoints ----------

  function setBreakpoint(key) {
    bp = key;
    iframe.style.width = canvasWidths[key];
    iframe.classList.toggle('wide', key === 'lg');
    render();
  }

  // ---------- drag and drop ----------

  function dragAllowedInto(node) {
    if (!drag) return false;
    if (drag.kind === 'new') return T.canContain(node.type, drag.type);
    return T.canMove(root(), drag.id, node.id);
  }

  // childGroups lists the child elements of a container, one entry per tree child.
  // A field in a table row has two cells, so its rects are joined.
  function childGroups(el) {
    const box = el.tagName === 'TABLE' ? el.tBodies[0] : el;
    const groups = [];
    for (const c of box.children) {
      if (!c.dataset.id) continue;
      const r = c.getBoundingClientRect();
      const last = groups[groups.length - 1];
      if (last && last.id === c.dataset.id) {
        last.rect = {
          left: Math.min(last.rect.left, r.left), top: Math.min(last.rect.top, r.top),
          right: Math.max(last.rect.right, r.right), bottom: Math.max(last.rect.bottom, r.bottom),
        };
      } else {
        groups.push({ id: c.dataset.id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
      }
    }
    for (const g of groups) {
      g.rect.width = g.rect.right - g.rect.left;
      g.rect.height = g.rect.bottom - g.rect.top;
    }
    return groups;
  }

  // dropTarget finds the innermost allowed container under the pointer and the insert position.
  function dropTarget(e) {
    let el = e.target.closest ? e.target.closest('[data-id]') : null;
    while (el) {
      const n = T.find(root(), el.dataset.id);
      if (n && dragAllowedInto(n.node)) break;
      el = el.parentElement && el.parentElement.closest('[data-id]');
    }
    if (!el) {
      if (!dragAllowedInto(root())) return null;
      el = elsFor(root().id)[0];
    }
    const horizontal = el.dataset.type === 'row' || el.dataset.type === 'tr';
    const kids = childGroups(el);
    let index = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].rect;
      const before = horizontal
        ? e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2)
        : e.clientY < r.top + r.height / 2;
      if (before) {
        index = i;
        break;
      }
    }
    return { el, parentId: el.dataset.id, index, horizontal, kids };
  }

  function showIndicator(t) {
    doc.querySelectorAll('.ed-drop').forEach((x) => x.classList.remove('ed-drop'));
    t.el.classList.add('ed-drop');
    if (!indicator || !indicator.isConnected) {
      indicator = doc.createElement('div');
      indicator.className = 'ed-indicator';
      doc.body.append(indicator);
    }
    const sx = doc.defaultView.scrollX;
    const sy = doc.defaultView.scrollY;
    const box = t.el.getBoundingClientRect();
    const ref = t.kids[t.index] || t.kids[t.kids.length - 1];
    const r = ref ? ref.rect : null;
    const after = !t.kids[t.index];
    let x, y, w, h;
    if (t.horizontal) {
      x = r ? (after ? r.right : r.left) : box.left + 4;
      y = r ? r.top : box.top + 4;
      w = 3;
      h = r ? r.height : box.height - 8;
    } else {
      x = box.left + 4;
      y = r ? (after ? r.bottom : r.top) : box.top + 4;
      w = box.width - 8;
      h = 3;
    }
    Object.assign(indicator.style, {
      left: `${x + sx - 1}px`, top: `${y + sy - 1}px`, width: `${w}px`, height: `${h}px`,
    });
  }

  function hideIndicator() {
    if (!doc) return;
    doc.querySelectorAll('.ed-drop').forEach((x) => x.classList.remove('ed-drop'));
    if (indicator) indicator.remove();
    indicator = null;
  }

  // fitNewCol: a new col is col-12 (full width on phones). Dropped into a row with
  // free space, it also gets the free width on large screens (col-lg-x).
  // The screen-size switch never changes this: editing always works on the Large layout.
  function fitNewCol(col, row) {
    const free = T.rowFreeSpace(row, 'lg');
    if (free <= 0 || free >= 12) return;
    T.setColWidth(col, 'lg', free);
  }

  // startNewDrag takes a palette type: 'row', 'text', … or 'field:<fieldType>'.
  function startNewDrag(type) {
    const [t, fieldType] = type.split(':');
    drag = { kind: 'new', type: t, fieldType };
  }

  function endDrag() {
    drag = null;
    hideIndicator();
  }

  function onDragStart(e) {
    if (resizing || editing || !editable()) {
      e.preventDefault();
      return;
    }
    const el = e.target.closest && e.target.closest('[data-id]');
    if (!el || !el.draggable) return;
    drag = { kind: 'move', id: el.dataset.id, type: el.dataset.type };
    e.dataTransfer.setData('text/plain', el.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e) {
    if (!drag || !editable()) return;
    const t = dropTarget(e);
    if (!t) {
      hideIndicator();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = drag.kind === 'new' ? 'copy' : 'move';
    showIndicator(t);
  }

  function onDrop(e) {
    if (!drag || !editable()) return;
    e.preventDefault();
    const t = dropTarget(e);
    const d = drag;
    endDrag();
    if (!t) return;
    let id;
    if (d.kind === 'new') {
      const nextId = T.idGen(root());
      const node = d.type === 'field' ? T.createField(root(), d.fieldType, nextId) : T.createNode(d.type, nextId);
      if (node.type === 'col') fitNewCol(node, T.find(root(), t.parentId).node);
      T.insert(root(), t.parentId, t.index, node);
      id = node.id;
    } else {
      T.move(root(), d.id, t.parentId, t.index);
      id = d.id;
    }
    commitChange(id);
  }

  // ---------- col resize ----------

  function onPointerDown(e) {
    if (!editable() || !e.target.classList.contains('ed-resize')) return;
    e.preventDefault();
    e.stopPropagation();
    const colEl = e.target.parentElement;
    const node = T.find(root(), colEl.dataset.id).node;
    const rowRect = colEl.parentElement.getBoundingClientRect();
    const left = colEl.getBoundingClientRect().left;
    const unit = rowRect.width / 12;
    const handle = e.target;
    handle.setPointerCapture(e.pointerId);
    resizing = true;
    let changed = false;

    const onMove = (ev) => {
      const span = Math.max(1, Math.min(12, Math.round((ev.clientX - left) / unit)));
      if (span !== T.effectiveWidth(node.props, 'lg')) {
        T.setColWidth(node, 'lg', span);
        applyClasses(colEl, node);
        updateRowGap(colEl.parentElement);
        changed = true;
      }
    };
    const onUp = () => {
      resizing = false;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (changed) onChange();
      select(node.id);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  // updateRowGap refreshes the empty-space marker of a row while a col is resized.
  function updateRowGap(rowEl) {
    const row = T.find(root(), rowEl.dataset.id).node;
    const free = T.rowFreeSpace(row, bp);
    let gap = rowEl.querySelector(':scope > .ed-empty');
    if (free <= 0) {
      if (gap) gap.remove();
      return;
    }
    if (!gap) {
      gap = doc.createElement('div');
      gap.textContent = 'empty';
      rowEl.append(gap);
    }
    gap.className = `col-${free} ed-empty`;
  }

  // ---------- double-click editing ----------

  // editText makes el editable in place. done(text) runs on Enter or blur when the text changed;
  // cancel() runs on Escape or when nothing changed.
  function editText(el, done, cancel = () => {}) {
    if (editing) return;
    const before = el.textContent;
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.classList.add('ed-editing');
    // Ancestors must not be draggable while editing, or text selection starts a drag.
    const dragged = [];
    for (let a = el; a; a = a.parentElement) {
      if (a.draggable) {
        dragged.push(a);
        a.draggable = false;
      }
    }
    editing = { el };
    el.focus();
    const range = doc.createRange();
    range.selectNodeContents(el);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.contentEditable = 'false';
      el.classList.remove('ed-editing');
      dragged.forEach((a) => { a.draggable = true; });
      editing = null;
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (save && text !== before.trim()) {
        done(text);
      } else {
        el.textContent = before;
        cancel();
      }
    };
    const onKey = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  }

  function onDblClick(e) {
    if (editing || !editable()) return;
    const el = e.target.closest && e.target.closest('[data-id]');
    if (!el) return;
    const n = T.find(root(), el.dataset.id);
    const node = n.node;

    if (node.type === 'text') {
      editText(el, (text) => {
        if (text) node.props.text = text;
        else if (T.canRemove(root(), node.id)) T.remove(root(), node.id);
        commitChange(text ? node.id : n.parent.id);
      });
      return;
    }
    if (node.type === 'flabel') {
      const f = T.find(root(), node.props.field);
      const lbl = el.querySelector('.ed-label');
      if (!f || !lbl) return;
      if (!String(f.node.props.label || '').trim()) lbl.textContent = '';
      editText(lbl, (text) => {
        setFieldLabel(f.node, text);
        commitChange(node.id);
      }, () => render());
      return;
    }
    if (node.type === 'field') {
      const lbl = e.target.closest('.ed-label') || el.querySelector('.ed-label');
      if (!lbl) return;
      editText(lbl, (text) => {
        setFieldLabel(node, text);
        commitChange(node.id);
      });
      return;
    }
    if (textHolders.has(node.type) && !(node.children || []).length) {
      const text = T.createNode('text', T.idGen(root()));
      text.props.text = '';
      T.insert(root(), node.id, 0, text);
      render();
      const span = elsFor(text.id)[0];
      editText(span, (value) => {
        if (value) text.props.text = value;
        else T.remove(root(), text.id);
        commitChange(value ? text.id : node.id);
      }, () => {
        // Nothing typed: take the empty text away again.
        T.remove(root(), text.id);
        render();
        select(node.id);
      });
    }
  }

  // ---------- context menu ----------

  function cardPartItems(card) {
    const header = card.children.find((c) => c.type === 'card-header');
    const body = card.children.find((c) => c.type === 'card-body');
    return [
      header
        ? { label: 'Remove header', action: () => removeNode(header.id) }
        : { label: 'Add header', action: () => run(() => T.addCardPart(root(), card.id, 'card-header'), card.id) },
      body
        ? { label: 'Remove body', action: () => removeNode(body.id) }
        : { label: 'Add body', action: () => run(() => T.addCardPart(root(), card.id, 'card-body'), card.id) },
    ];
  }

  function tableItems(node) {
    const table = T.tableOf(root(), node.id);
    const items = [
      { label: 'Add row', action: () => run(() => T.tableAddRow(root(), node.id).id) },
      {
        label: 'Remove row',
        disabled: node.type === 'table' || table.children.length < 2,
        action: () => run(() => T.tableRemoveRow(root(), node.id), table.id),
      },
      { label: 'Add column', action: () => run(() => T.tableAddCol(root(), node.id), table.id) },
      {
        label: 'Remove last column',
        disabled: T.tableCols(table) < 2,
        action: () => run(() => T.tableRemoveCol(root(), node.id), table.id),
      },
    ];
    // The cell itself, or the cell that holds the clicked text, field or label.
    const parent = T.find(root(), node.id).parent;
    const cell = T.isCell(node) ? node : T.isCell(parent) ? parent : null;
    if (cell) {
      items.push({
        label: cell.type === 'th' ? 'Make data cell (td)' : 'Make header cell (th)',
        action: () => run(() => T.toggleCell(cell), node.id),
      });
    }
    return items;
  }

  function inTable(node) {
    return !!T.tableOf(root(), node.id);
  }

  function inList(node) {
    const n = T.find(root(), node.id);
    return ['ul', 'ol', 'li'].includes(node.type) || (n.parent && n.parent.type === 'li');
  }

  function menuItems(node) {
    if (node.type === 'card-header' || node.type === 'card-body') {
      return [{ label: 'Format…', action: () => openFormat(node) }, null, ...cardPartItems(T.find(root(), node.id).parent)];
    }
    const items = [{ label: 'Format…', action: () => openFormat(node) }, null];
    if (node.type === 'card') items.push(...cardPartItems(node), null);
    if (node.type === 'field' && T.isCell(T.find(root(), node.id).parent) && T.hasLabel(node)
        && !T.fieldLabels(root(), node.id).length) {
      items.push({ label: 'Add label cell', action: () => run(() => T.addFieldLabel(root(), node.id), node.id) });
    }
    if (T.repeatTypes.has(node.type)) {
      const r = T.repeatCount(node);
      const problem = T.listProblem(root(), node);
      if (r > 1) {
        items.push({ label: `List size… (now ${r})`, action: () => askRepeat(node, r) });
        items.push({ label: 'Stop list', action: () => run(() => T.setRepeat(node, 1), node.id) });
      } else {
        items.push({ label: problem ? `Make list… (${problem})` : 'Make list…', disabled: !!problem, action: () => askRepeat(node, 3) });
      }
      items.push(null);
    }
    if (node.type === 'flabel' && T.find(root(), node.props.field)) {
      items.push({ label: 'Select field', action: () => select(node.props.field) });
    }
    if (inTable(node)) items.push(...tableItems(node), null);
    if (inList(node)) items.push({ label: 'Add item', action: () => run(() => T.listAddItem(root(), node.id).id) }, null);
    if (node.id !== root().id) {
      items.push({ label: 'Duplicate', action: () => duplicateNode(node.id) });
      const canDel = T.canRemove(root(), node.id);
      items.push({
        label: canDel ? 'Delete' : 'Delete (holds the name field)',
        disabled: !canDel,
        danger: true,
        action: () => removeNode(node.id),
      });
    }
    if (items[items.length - 1] === null) items.pop();
    return items;
  }

  function onContextMenu(e) {
    if (!editable()) return;
    e.preventDefault();
    if (editing) return;
    const el = e.target.closest && e.target.closest('[data-id]');
    if (!el) return;
    const node = T.find(root(), el.dataset.id).node;
    select(node.id);
    const items = menuItems(node);
    if (!items.length) return;
    const r = iframe.getBoundingClientRect();
    openMenu(items, r.left + e.clientX, r.top + e.clientY);
  }

  function askRepeat(node, current) {
    const answer = window.prompt('How many entries? (2 to 99)', String(current));
    if (answer === null) return;
    const n = Math.round(Number(answer));
    if (!(n >= 2 && n <= 99)) {
      window.alert('Please enter a number from 2 to 99.');
      return;
    }
    run(() => T.setRepeat(node, n), node.id);
  }

  // ---------- actions ----------

  function commitChange(selectId) {
    onChange();
    render();
    select(selectId);
  }

  // run applies a change. The id to select is fn's return value if it is a string, else fallbackId.
  function run(fn, fallbackId) {
    const r = fn();
    commitChange(typeof r === 'string' ? r : fallbackId || selectedId);
  }

  function removeNode(id) {
    const n = T.find(root(), id);
    if (!n || !T.canRemove(root(), id)) return;
    T.remove(root(), id);
    commitChange(n.parent.id);
  }

  function duplicateNode(id) {
    commitChange(T.duplicate(root(), id).id);
  }

  // ---------- wiring ----------

  function onClick(e) {
    if (!editable()) return;
    if (editing && editing.el.contains(e.target)) return;
    const el = e.target.closest && e.target.closest('[data-id]');
    select(el ? el.dataset.id : root().id);
  }

  function onMouseOver(e) {
    if (!editable()) return;
    doc.querySelectorAll('.ed-hover').forEach((x) => x.classList.remove('ed-hover'));
    const el = e.target.closest && e.target.closest('[data-id]');
    if (el) el.classList.add('ed-hover');
  }

  function attach() {
    const d = iframe.contentDocument;
    if (!d || !d.getElementById('sheet')) return;
    doc = d;
    doc.addEventListener('click', onClick);
    doc.addEventListener('dblclick', onDblClick);
    doc.addEventListener('mouseover', onMouseOver);
    doc.addEventListener('contextmenu', onContextMenu);
    doc.addEventListener('dragstart', onDragStart);
    doc.addEventListener('dragover', onDragOver);
    doc.addEventListener('drop', onDrop);
    doc.addEventListener('dragend', endDrag);
    doc.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('mousedown', () => openMenu(null));
    render();
    select(selectedId);
  }

  iframe.addEventListener('load', attach);
  attach();
  setBreakpoint(bp);

  return {
    render,
    select,
    setMode,
    setPreviewHtml,
    get mode() { return mode; },
    setBreakpoint,
    startNewDrag,
    endDrag,
    duplicate: duplicateNode,
    remove: removeNode,
    get selectedId() { return selectedId; },
    get editing() { return !!editing; },
  };
}
