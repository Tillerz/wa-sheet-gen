// Sheet layout tree: pure functions, no DOM. Nesting rules follow bible 5.1.

export const allowedChildren = {
  container: ['row'],
  row: ['col'],
  col: ['row', 'card', 'field', 'ul', 'ol', 'table', 'text', 'image'],
  card: ['card-header', 'card-body'],
  'card-header': ['text'],
  'card-body': ['row', 'field', 'ul', 'ol', 'table', 'text', 'image'],
};

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

function maxId(root) {
  let max = 0;
  walk(root, (n) => {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

// idGen returns a function that hands out ids not yet used in root.
export function idGen(root) {
  let next = maxId(root) + 1;
  return () => 'n' + next++;
}

export function createNode(type, nextId) {
  switch (type) {
    case 'row':
      return { id: nextId(), type: 'row', children: [] };
    case 'col':
      return { id: nextId(), type: 'col', props: { col: 6 }, children: [] };
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
export function insert(root, parentId, index, node) {
  const p = find(root, parentId);
  if (!p) throw new Error('target not found');
  if (!canContain(p.node.type, node.type)) {
    throw new Error(`a ${node.type} cannot go into a ${p.node.type}`);
  }
  const kids = (p.node.children ||= []);
  const i = Math.max(0, Math.min(index, kids.length));
  kids.splice(i, 0, node);
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
  n.parent.children.splice(n.index, 1);
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
}

function fieldNames(root) {
  const names = new Set();
  walk(root, (n) => {
    if (n.type === 'field' && n.props && n.props.name) names.add(n.props.name);
  });
  return names;
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
  walk(copy, (c) => {
    c.id = nextId();
    if (c.type === 'field' && c.props) {
      const name = uniqueFieldName(c.props.name, used);
      used.add(name);
      if (c.props.label === c.props.name) c.props.label = name;
      c.props.name = name;
      delete c.props.required;
    }
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
