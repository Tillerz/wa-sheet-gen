// Sheet layout tree: pure functions, no DOM. Nesting rules follow bible 5.1.

export const allowedChildren = {
  container: ['row'],
  row: ['col'],
  col: ['row', 'card', 'field', 'ul', 'ol', 'table', 'text', 'image'],
  card: ['card-header', 'card-body'],
  'card-header': ['text'],
  'card-body': ['row', 'field', 'ul', 'ol', 'table', 'text', 'image'],
  ul: ['li'],
  ol: ['li'],
  li: ['text', 'field'],
  table: ['tr'],
  tr: ['th', 'td'],
  // A field in a table: its label (flabel) sits in a th, the field (value) in the next td.
  th: ['text', 'field', 'flabel'],
  td: ['text', 'field', 'flabel'],
};

export const fieldTypes = ['string', 'number', 'text', 'checkbox', 'select', 'suggest', 'image', 'calc'];

export function canContain(parentType, childType) {
  return (allowedChildren[parentType] || []).includes(childType);
}

// find returns { node, parent, index } for id, or null.
export function find(root, id, parent = null, index = -1) {
  if (root.id === id) return { node: root, parent, index };
  const kids = root.children || [];
  for (let i = 0; i < kids.length; i++) {
    const r = find(kids[i], id, root, i);
    if (r) return r;
  }
  return null;
}

export function walk(node, fn) {
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}

function maxId(node) {
  let max = 0;
  walk(node, (n) => {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

// idGen returns a function that hands out ids not yet used in root
// (nor in the extra nodes, e.g. one that is being moved or inserted).
export function idGen(root, ...extra) {
  let next = Math.max(maxId(root), ...extra.map(maxId)) + 1;
  return () => 'n' + next++;
}

export function createNode(type, nextId) {
  switch (type) {
    case 'row':
      return { id: nextId(), type: 'row', children: [] };
    case 'col':
      return { id: nextId(), type: 'col', props: { col: 12 }, children: [] };
    case 'card':
      return {
        id: nextId(), type: 'card', props: {}, children: [
          createNode('card-header', nextId),
          createNode('card-body', nextId),
        ],
      };
    case 'card-header':
      return {
        id: nextId(), type: 'card-header', children: [
          { id: nextId(), type: 'text', props: { text: 'Header' } },
        ],
      };
    case 'card-body':
      return { id: nextId(), type: 'card-body', children: [] };
    case 'ul':
    case 'ol':
      return { id: nextId(), type, children: [createNode('li', nextId), createNode('li', nextId)] };
    case 'li':
      return { id: nextId(), type: 'li', children: [{ id: nextId(), type: 'text', props: { text: 'Item' } }] };
    case 'table':
      return {
        id: nextId(), type: 'table', children: [
          { id: nextId(), type: 'tr', children: [createNode('th', nextId), createNode('td', nextId)] },
          { id: nextId(), type: 'tr', children: [createNode('th', nextId), createNode('td', nextId)] },
        ],
      };
    case 'tr':
      return { id: nextId(), type: 'tr', children: [] };
    case 'th':
    case 'td':
      return { id: nextId(), type, children: [] };
    case 'text':
      return { id: nextId(), type: 'text', props: { text: 'Text' } };
    case 'image':
      return { id: nextId(), type: 'image', props: { imageId: '' } };
    default:
      throw new Error('unknown element type: ' + type);
  }
}

export function isAncestor(root, ancestorId, id) {
  const a = find(root, ancestorId);
  return !!(a && find(a.node, id));
}

export function containsRequired(node) {
  let found = false;
  walk(node, (n) => {
    if (n.type === 'field' && n.props && n.props.required) found = true;
  });
  return found;
}

// insert puts node into parent at index. Throws if the nesting rules forbid it.
// A field with a label that goes into a table cell is split over two cells (see placeFieldInCell).
export function insert(root, parentId, index, node) {
  const p = find(root, parentId);
  if (!p) throw new Error('target not found');
  if (!canContain(p.node.type, node.type)) {
    throw new Error(`a ${node.type} cannot go into a ${p.node.type}`);
  }
  if (node.type === 'field' && isCell(p.node) && hasLabel(node) && labelMode(root, p.node.id) === 'left') {
    placeFieldInCell(root, p.node, node);
    return;
  }
  const kids = (p.node.children ||= []);
  const i = Math.max(0, Math.min(index, kids.length));
  kids.splice(i, 0, node);
  // Labels on top: the field's cell holds an input, so it is a td; the label goes
  // into the header row above it.
  if (node.type === 'field' && isCell(p.node)) {
    p.node.type = 'td';
    if (hasLabel(node)) addFieldLabel(root, node.id);
  }
}

// labelMode of the table that holds id: 'left' (label cell before each field) or
// 'top' (labels in the header row, the first row of the table).
export function labelMode(root, id) {
  const t = tableOf(root, id);
  return t && t.props && t.props.labels === 'top' ? 'top' : 'left';
}

function isEmptyCell(c) {
  return (c.children || []).every((x) => x.type === 'text' && !(x.props && x.props.text));
}

// addHeaderLabel puts the field's label into the header row, in the column of its cell.
// A field in the first row gets a new header row above it. A header cell with content stays as it is.
function addHeaderLabel(root, n) {
  const table = tableOf(root, n.node.id);
  const row = rowOf(root, n.node.id);
  const col = row.children.indexOf(n.parent);
  const nextId = idGen(root);
  if (table.children[0] === row) table.children.unshift({ id: nextId(), type: 'tr', children: [] });
  const header = table.children[0];
  while (header.children.length <= col) header.children.push(createNode('th', nextId));
  const cell = header.children[col];
  if (!isEmptyCell(cell)) return;
  cell.type = 'th';
  cell.children = [{ id: nextId(), type: 'flabel', props: { field: n.node.id } }];
}

// setLabelMode switches a table between labels left and on top, and moves the labels
// of its fields. Cells that held labels stay (empty), so nothing else moves.
export function setLabelMode(root, tableId, mode) {
  const table = find(root, tableId).node;
  table.props ||= {};
  if (mode === 'top') table.props.labels = 'top';
  else delete table.props.labels;
  const fields = [];
  walk(table, (c) => { if (c.type === 'field') fields.push(c); });
  dropFieldLabels(root, new Set(fields.map((f) => f.id)));
  for (const f of fields) if (hasLabel(f)) addFieldLabel(root, f.id);
}

export function isCell(n) {
  return !!n && (n.type === 'th' || n.type === 'td');
}

export function hasLabel(field) {
  return !!(field.props && String(field.props.label || '').trim());
}

// placeFieldInCell: the cell becomes a th with the field's label, the next cell
// (made if missing) becomes a td with the field itself.
function placeFieldInCell(root, cell, field) {
  const nextId = idGen(root, field);
  const row = rowOf(root, cell.id);
  cell.type = 'th';
  (cell.children ||= []).push({ id: nextId(), type: 'flabel', props: { field: field.id } });
  const at = row.children.indexOf(cell) + 1;
  let next = row.children[at];
  if (!next) {
    next = createNode('td', nextId);
    row.children.splice(at, 0, next);
  }
  next.type = 'td';
  (next.children ||= []).push(field);
}

// fieldLabels lists the field labels (flabel) that show the label of field id.
export function fieldLabels(root, fieldId) {
  const out = [];
  walk(root, (n) => {
    if (n.type === 'flabel' && n.props && n.props.field === fieldId) out.push(n);
  });
  return out;
}

function dropFieldLabels(root, fieldIds) {
  walk(root, (n) => {
    if (n.children) n.children = n.children.filter((c) => !(c.type === 'flabel' && c.props && fieldIds.has(c.props.field)));
  });
}

// addFieldLabel gives a field in a cell its label cell again: the cell before it
// (made if missing) becomes a th with a field label.
export function addFieldLabel(root, fieldId) {
  const n = find(root, fieldId);
  if (!n || !isCell(n.parent) || fieldLabels(root, fieldId).length) return;
  if (labelMode(root, fieldId) === 'top') {
    addHeaderLabel(root, n);
    return;
  }
  const row = rowOf(root, n.parent.id);
  const at = row.children.indexOf(n.parent);
  const nextId = idGen(root);
  let prev = row.children[at - 1];
  if (!prev) {
    prev = createNode('th', nextId);
    row.children.splice(at, 0, prev);
  }
  prev.type = 'th';
  (prev.children ||= []).push({ id: nextId(), type: 'flabel', props: { field: fieldId } });
}

// takeOut removes n from its parent. A field that moves leaves its labels behind
// no more: they are removed (insert makes a new one in the new cell).
function takeOut(root, n) {
  n.parent.children.splice(n.index, 1);
  if (n.node.type === 'field') dropFieldLabels(root, new Set([n.node.id]));
}

// canMove tells whether element id may be moved into parentId.
export function canMove(root, id, parentId) {
  const n = find(root, id);
  const p = find(root, parentId);
  if (!n || !p || !n.parent) return false;
  if (id === parentId || isAncestor(root, id, parentId)) return false;
  return canContain(p.node.type, n.node.type);
}

// move moves element id to parentId at index. index counts positions
// in the target as it looks before the move.
export function move(root, id, parentId, index) {
  if (!canMove(root, id, parentId)) throw new Error('this move is not allowed');
  const n = find(root, id);
  const sameParent = n.parent.id === parentId;
  takeOut(root, n);
  const i = sameParent && n.index < index ? index - 1 : index;
  insert(root, parentId, i, n.node);
}

export function canRemove(root, id) {
  const n = find(root, id);
  return !!(n && n.parent && !containsRequired(n.node));
}

export function remove(root, id) {
  if (!canRemove(root, id)) throw new Error('this element cannot be deleted');
  const n = find(root, id);
  n.parent.children.splice(n.index, 1);
  // Labels of removed fields go too.
  const gone = new Set();
  walk(n.node, (c) => { if (c.type === 'field') gone.add(c.id); });
  if (gone.size) dropFieldLabels(root, gone);
}

// uniqueFieldName adds or increases a numeric suffix: weapon → weapon_2 → weapon_3.
export function uniqueFieldName(name, used) {
  const m = /^(.*?)_(\d+)$/.exec(name);
  const base = m ? m[1] : name;
  let i = m ? Number(m[2]) + 1 : 2;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// duplicate inserts a deep copy of element id right after it and returns the copy.
// Copied fields get new unique names; a copy is never required.
export function duplicate(root, id) {
  const n = find(root, id);
  if (!n || !n.parent) throw new Error('this element cannot be duplicated');
  const nextId = idGen(root);
  const used = fieldNames(root);
  const copy = structuredClone(n.node);
  const newIds = {};
  // Every list in the copy (the copy itself or a list inside, e.g. a table row) continues:
  // same field names, the next numbers (1..20 → 21..40). Fields outside lists get new names.
  const visit = (c, inList) => {
    if (repeatCount(c) > 1) {
      const [a, b] = listRange(c);
      c.props.repeatStart = b + 1;
      c.props.repeat = b - a + 1;
      inList = true;
    }
    const id = nextId();
    newIds[c.id] = id;
    c.id = id;
    if (c.type === 'field' && c.props) {
      if (!inList) {
        const name = uniqueFieldName(c.props.name, used);
        used.add(name);
        if (c.props.label === c.props.name) c.props.label = name;
        c.props.name = name;
      }
      delete c.props.required;
    }
    for (const k of c.children || []) visit(k, inList);
  };
  visit(copy, false);
  // Field labels in the copy point to the copied fields.
  walk(copy, (c) => {
    if (c.type === 'flabel' && newIds[c.props.field]) c.props.field = newIds[c.props.field];
  });
  n.parent.children.splice(n.index + 1, 0, copy);
  return copy;
}

// Card parts: at most one header (always first) and one body.

export function hasPart(card, type) {
  return (card.children || []).some((c) => c.type === type);
}

export function addCardPart(root, cardId, type) {
  const c = find(root, cardId);
  if (!c || c.node.type !== 'card') throw new Error('not a card');
  if (hasPart(c.node, type)) return;
  const part = createNode(type, idGen(root));
  const kids = (c.node.children ||= []);
  if (type === 'card-header') kids.unshift(part);
  else kids.push(part);
}

// Col widths per breakpoint. key is 'col', 'md' or 'lg'; null unsets it.

export const breakpoints = ['col', 'md', 'lg'];

export function setColWidth(node, key, value) {
  if (!breakpoints.includes(key)) throw new Error('unknown breakpoint ' + key);
  node.props ||= {};
  if (value === null || value === '' || value === undefined) {
    delete node.props[key];
    return;
  }
  node.props[key] = Math.max(1, Math.min(12, Math.round(Number(value))));
}

// effectiveWidth is the width Bootstrap uses at a breakpoint (mobile first), or null for auto.
export function effectiveWidth(props = {}, key) {
  const order = breakpoints.slice(0, breakpoints.indexOf(key) + 1).reverse();
  for (const k of order) if (props[k]) return props[k];
  return null;
}

export function colClasses(props = {}) {
  const cls = [];
  if (props.col) cls.push(`col-${props.col}`);
  if (props.md) cls.push(`col-md-${props.md}`);
  if (props.lg) cls.push(`col-lg-${props.lg}`);
  return cls.length ? cls : ['col'];
}

// ---------- fields ----------

export function fieldNames(root) {
  const names = new Set();
  walk(root, (n) => {
    if (n.type === 'field' && n.props && n.props.name) names.add(n.props.name);
  });
  return names;
}

// toFieldName turns a label into a field name: "HP Max" → "hp_max".
export function toFieldName(label) {
  let n = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!n) return '';
  if (!/^[a-z]/.test(n)) n = 'f_' + n;
  return n;
}

// fieldNameError checks the naming rule (bible 3.4). rules comes from /api/rules.
export function fieldNameError(name, rules, used) {
  if (!rules.fieldNameRe.test(name)) return 'Start with a-z, then use only a-z, 0-9 and single _ between words.';
  const bad = rules.bannedWords.find((w) => name.includes(w));
  if (bad) return `Contains "${bad}", which the WA filter removes.`;
  if (used && used.has(name)) return 'Another field already has this name.';
  return '';
}

export function createField(root, fieldType, nextId) {
  if (!fieldTypes.includes(fieldType)) throw new Error('unknown field type: ' + fieldType);
  const used = fieldNames(root);
  const name = used.has('new_field') ? uniqueFieldName('new_field', used) : 'new_field';
  const props = { fieldType, name, label: name.replaceAll('_', ' ') };
  if (fieldType === 'text') props.rows = 3;
  if (fieldType === 'calc') props.formula = '';
  if (fieldType === 'select' || fieldType === 'suggest') props.options = ['Option 1', 'Option 2'];
  return { id: nextId(), type: 'field', props };
}

// ---------- tables ----------

// tableCols counts the cells of the widest row.
export function tableCols(table) {
  let max = 1;
  for (const tr of table.children || []) max = Math.max(max, (tr.children || []).length);
  return max;
}

function tableOf(root, id) {
  let n = find(root, id);
  while (n && n.node.type !== 'table') n = n.parent ? find(root, n.parent.id) : null;
  return n ? n.node : null;
}

function rowOf(root, id) {
  let n = find(root, id);
  while (n && n.node.type !== 'tr') n = n.parent ? find(root, n.parent.id) : null;
  return n ? n.node : null;
}

export { tableOf, rowOf };

// tableAddRow adds an empty row after the row holding id (or at the end).
export function tableAddRow(root, id) {
  const table = tableOf(root, id);
  if (!table) throw new Error('not in a table');
  const nextId = idGen(root);
  const tr = createNode('tr', nextId);
  for (let i = 0; i < tableCols(table); i++) tr.children.push(createNode('td', nextId));
  const row = rowOf(root, id);
  const at = row ? table.children.indexOf(row) + 1 : table.children.length;
  table.children.splice(at, 0, tr);
  return tr;
}

export function tableRemoveRow(root, id) {
  const table = tableOf(root, id);
  const row = rowOf(root, id);
  if (!table || !row || table.children.length < 2) return false;
  if (containsRequired(row)) return false;
  remove(root, row.id);
  return true;
}

export function tableAddCol(root, id) {
  const table = tableOf(root, id);
  if (!table) throw new Error('not in a table');
  const nextId = idGen(root);
  for (const tr of table.children) tr.children.push(createNode('td', nextId));
}

// tableRemoveCol removes the last cell of every row. A cell with a field stays.
export function tableRemoveCol(root, id) {
  const table = tableOf(root, id);
  if (!table || tableCols(table) < 2) return false;
  for (const tr of table.children) {
    const last = tr.children[tr.children.length - 1];
    const hasField = last && (last.children || []).some((c) => c.type === 'field');
    if (tr.children.length > 1 && last && !hasField) remove(root, last.id);
  }
  return true;
}

export function toggleCell(node) {
  if (node.type === 'th') node.type = 'td';
  else if (node.type === 'td') node.type = 'th';
}

// ---------- lists ----------

// listAddItem adds an item after the li holding id (or at the end of the list id).
export function listAddItem(root, id) {
  let n = find(root, id);
  let li = null;
  while (n && n.node.type !== 'ul' && n.node.type !== 'ol') {
    if (n.node.type === 'li') li = n.node;
    n = n.parent ? find(root, n.parent.id) : null;
  }
  if (!n) throw new Error('not in a list');
  const item = createNode('li', idGen(root));
  const kids = n.node.children;
  kids.splice(li ? kids.indexOf(li) + 1 : kids.length, 0, item);
  return item;
}

// rowFreeSpace is how many of the 12 grid columns stay empty on the last line
// of a row at a breakpoint. Auto-width cols fill the line, so then nothing is free.
export function rowFreeSpace(row, key) {
  let line = 0;
  for (const c of row.children || []) {
    const w = effectiveWidth(c.props, key);
    if (w === null) return 0;
    line = line + w > 12 ? w : line + w;
  }
  return 12 - line;
}

// ---------- lists (bible 11) ----------

// repeatTypes can repeat as a list: exported once inside a Twig loop.
export const repeatTypes = new Set(['row', 'col', 'card', 'tr', 'li']);

export function repeatCount(node) {
  const r = node.props && Number(node.props.repeat);
  return r > 1 ? r : 1;
}

// maxListNumber is the highest entry number of a list (same as in Go).
export const maxListNumber = 199;

// repeatStart is the number of a list's first entry, default 1. A long list split over
// several cards uses e.g. 1..20, 21..40, 41..60.
export function repeatStart(node) {
  const s = node.props && Number(node.props.repeatStart);
  return s >= 1 ? s : 1;
}

// listRange returns [first, last] entry number of a list.
export function listRange(node) {
  const s = repeatStart(node);
  return [s, s + repeatCount(node) - 1];
}

// setListRange makes node a list from..to (to - from >= 1, to <= 199), or a normal block.
export function setListRange(node, from, to) {
  node.props ||= {};
  const a = Math.max(1, Math.round(Number(from)) || 1);
  const b = Math.min(maxListNumber, Math.round(Number(to)) || 0);
  if (b - a < 1) {
    delete node.props.repeat;
    delete node.props.repeatStart;
    return;
  }
  node.props.repeat = b - a + 1;
  if (a > 1) node.props.repeatStart = a;
  else delete node.props.repeatStart;
}

// listProblem tells why node cannot become a list, or ''.
export function listProblem(root, node) {
  if (!repeatTypes.has(node.type)) return 'Only rows, cols, cards, table rows and list items can repeat.';
  if (containsRequired(node)) return 'The name field cannot be inside a list.';
  let inner = false;
  walk(node, (c) => { if (c !== node && repeatCount(c) > 1) inner = true; });
  if (inner) return 'It already holds a list.';
  for (let n = find(root, node.id); n && n.parent; n = find(root, n.parent.id)) {
    if (repeatCount(n.parent) > 1) return 'It is inside a list.';
  }
  return '';
}

// setRepeat makes node a list of count entries from its current start, or a normal
// block (count 1 or empty).
export function setRepeat(node, count) {
  const n = Math.round(Number(count));
  const s = repeatStart(node);
  setListRange(node, s, n >= 2 ? s + n - 1 : s);
}

// listOf returns the list (node or ancestor) that node is in, or null.
export function listOf(root, id) {
  for (let n = find(root, id); n; n = n.parent ? find(root, n.parent.id) : null) {
    if (repeatCount(n.node) > 1) return n.node;
  }
  return null;
}

export const repeatNames = { row: 'row', col: 'col', card: 'card', tr: 'table row', li: 'list item' };

// repeatTarget is the element that a list for id applies to: the list it is already in,
// else the nearest element (itself or around it) that can repeat. null if none.
export function repeatTarget(root, id) {
  const list = listOf(root, id);
  if (list) return list;
  for (let n = find(root, id); n; n = n.parent ? find(root, n.parent.id) : null) {
    if (repeatTypes.has(n.node.type)) return n.node;
  }
  return null;
}
