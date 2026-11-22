// Canvas editor: renders the tree into the canvas iframe and handles
// selection, drag and drop, col resizing and the right-click menu.
import * as T from './tree.js';

const canvasWidths = { col: '420px', md: '820px', lg: '100%' };
const draggableTypes = new Set(['row', 'col', 'card', 'field']);

export function createEditor({ iframe, getProject, onChange, onSelect, openMenu }) {
  let doc = null;
  let bp = 'col';
  let selectedId = null;
  let drag = null; // { kind: 'new', type } or { kind: 'move', id, type }
  let indicator = null;
  let resizing = false;

  const root = () => getProject().root;

  // ---------- rendering ----------

  function tagText(node) {
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
      case 'field': return `field ${p.name}`;
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
      default: return [];
    }
  }

  function applyClasses(el, node) {
    el.className = [...nodeClasses(node), 'ed-node'].join(' ');
    if (node.id === selectedId) el.classList.add('ed-selected');
    el.dataset.tag = tagText(node);
  }

  // renderNode builds DOM with textContent only, so user text can never become HTML.
  function renderNode(node) {
    const el = doc.createElement(node.type === 'text' ? 'span' : 'div');
    el.dataset.id = node.id;
    el.dataset.type = node.type;
    applyClasses(el, node);
    if (draggableTypes.has(node.type)) el.draggable = true;
    const p = node.props || {};

    if (node.type === 'text') {
      el.textContent = p.text || '';
      return el;
    }
    if (node.type === 'field') {
      const cls = String(p.name || '').replaceAll('_', '-');
      const lbl = doc.createElement('div');
      lbl.className = `lbl lbl-${cls}`;
      lbl.textContent = p.label || p.name;
      const val = doc.createElement('div');
      val.className = `var var-${cls}`;
      el.append(lbl, val);
      return el;
    }
    for (const child of node.children || []) el.append(renderNode(child));
    if (node.type === 'col') {
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
    doc.getElementById('sheet').replaceChildren(renderNode(root()));
  }

  function elFor(id) {
    return doc && doc.querySelector(`[data-id="${CSS.escape(id)}"]`);
  }

  // ---------- selection ----------

  function select(id) {
    selectedId = id && T.find(root(), id) ? id : null;
    if (doc) {
      doc.querySelectorAll('.ed-selected').forEach((e) => e.classList.remove('ed-selected'));
      const el = selectedId && elFor(selectedId);
      if (el) el.classList.add('ed-selected');
    }
    onSelect(selectedId ? T.find(root(), selectedId).node : null);
  }

  // ---------- breakpoints ----------

  function setBreakpoint(key) {
    bp = key;
    iframe.style.width = canvasWidths[key];
    iframe.classList.toggle('wide', key === 'lg');
  }

  // ---------- drag and drop ----------

  function dragAllowedInto(node) {
    if (!drag) return false;
    if (drag.kind === 'new') return T.canContain(node.type, drag.type);
    return T.canMove(root(), drag.id, node.id);
  }

  function childEls(el) {
    return [...el.children].filter((c) => c.dataset.id);
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
      el = elFor(root().id);
    }
    const horizontal = el.dataset.type === 'row';
    const kids = childEls(el);
    let index = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
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
    const r = ref ? ref.getBoundingClientRect() : null;
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

  function startNewDrag(type) {
    drag = { kind: 'new', type };
  }

  function endDrag() {
    drag = null;
    hideIndicator();
  }

  function onDragStart(e) {
    if (resizing) {
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
    if (!drag) return;
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
    if (!drag) return;
    e.preventDefault();
    const t = dropTarget(e);
    const d = drag;
    endDrag();
    if (!t) return;
    let id;
    if (d.kind === 'new') {
      const node = T.createNode(d.type, T.idGen(root()));
      T.insert(root(), t.parentId, t.index, node);
      id = node.id;
    } else {
      T.move(root(), d.id, t.parentId, t.index);
      id = d.id;
    }
    onChange();
    render();
    select(id);
  }

  // ---------- col resize ----------

  function onPointerDown(e) {
    if (!e.target.classList.contains('ed-resize')) return;
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
      if (span !== T.effectiveWidth(node.props, bp)) {
        T.setColWidth(node, bp, span);
        applyClasses(colEl, node);
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

  // ---------- context menu ----------

  function cardPartItems(card) {
    const header = card.children.find((c) => c.type === 'card-header');
    const body = card.children.find((c) => c.type === 'card-body');
    return [
      header
        ? { label: 'Remove header', action: () => removeNode(header.id) }
        : { label: 'Add header', action: () => addPart(card.id, 'card-header') },
      body
        ? { label: 'Remove body', action: () => removeNode(body.id) }
        : { label: 'Add body', action: () => addPart(card.id, 'card-body') },
    ];
  }

  function menuItems(node) {
    if (node.type === 'card-header' || node.type === 'card-body') {
      return cardPartItems(T.find(root(), node.id).parent);
    }
    const items = [];
    if (node.type === 'card') items.push(...cardPartItems(node), null);
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
    e.preventDefault();
    const el = e.target.closest && e.target.closest('[data-id]');
    if (!el) return;
    const n = T.find(root(), el.dataset.id);
    // Text has no own menu yet (editing comes in milestone 3): use its container.
    const node = n.node.type === 'text' ? n.parent : n.node;
    select(node.id);
    const items = menuItems(node);
    if (!items.length) return;
    const r = iframe.getBoundingClientRect();
    openMenu(items, r.left + e.clientX, r.top + e.clientY);
  }

  // ---------- actions ----------

  function removeNode(id) {
    const n = T.find(root(), id);
    if (!n || !T.canRemove(root(), id)) return;
    T.remove(root(), id);
    onChange();
    render();
    select(n.parent.id);
  }

  function duplicateNode(id) {
    const copy = T.duplicate(root(), id);
    onChange();
    render();
    select(copy.id);
  }

  function addPart(cardId, type) {
    T.addCardPart(root(), cardId, type);
    onChange();
    render();
    select(cardId);
  }

  // ---------- wiring ----------

  function onClick(e) {
    const el = e.target.closest && e.target.closest('[data-id]');
    select(el ? el.dataset.id : root().id);
  }

  function onMouseOver(e) {
    doc.querySelectorAll('.ed-hover').forEach((x) => x.classList.remove('ed-hover'));
    const el = e.target.closest && e.target.closest('[data-id]');
    if (el) el.classList.add('ed-hover');
  }

  function attach() {
    const d = iframe.contentDocument;
    if (!d || !d.getElementById('sheet')) return;
    doc = d;
    doc.addEventListener('click', onClick);
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
    setBreakpoint,
    startNewDrag,
    endDrag,
    duplicate: duplicateNode,
    remove: removeNode,
    get selectedId() { return selectedId; },
  };
}
