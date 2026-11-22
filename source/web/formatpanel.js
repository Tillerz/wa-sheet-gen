// Format controls for the properties panel (bible 7). Builds DOM only; storing is done by set().

const boxTypes = new Set(['card', 'card-header', 'card-body', 'table', 'th', 'td']);

// Field looks: label (sheet + form), value (sheet), input (form).
export const fieldLooks = [
  ['fmtLabel', 'Label'],
  ['fmt', 'Value'],
  ['fmtInput', 'Input'],
];

export function fmtKeyFor(node, look) {
  return node.type === 'field' ? look : 'fmt';
}

// boxKind tells which box formats an element takes: 'full' (border, radius, background),
// 'bg' (background only, the sheet root) or 'none'.
export function boxKind(node, look) {
  if (node.type === 'field') return look === 'fmtLabel' ? 'none' : 'full';
  if (node.type === 'container') return 'bg';
  return boxTypes.has(node.type) ? 'full' : 'none';
}

export function canFormat(node) {
  // A field label is formatted through its field (Label look).
  return node.type !== 'image' && node.type !== 'flabel';
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e[k] = v;
  }
  e.append(...children);
  return e;
}

function row(label, ...controls) {
  return el('div', { class: 'fmt-row' }, el('span', { class: 'fmt-label', textContent: label }), el('div', { class: 'fmt-controls' }, ...controls));
}

function toggle(text, title, active, onClick, extraClass = '') {
  return el('button', {
    type: 'button', textContent: text, title, class: `fmt-btn ${extraClass}${active ? ' active' : ''}`, onclick: onClick,
  });
}

// colorField: text input (hex or var(--name)), a color picker and a clear button.
function colorField(value, colorRe, onSet) {
  const text = el('input', {
    type: 'text', value: value || '', placeholder: '#rrggbb or var(--dark)', spellcheck: false,
  });
  text.setAttribute('list', 'themeColors');
  const isHex6 = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
  const pick = el('input', { type: 'color', value: isHex6(value) ? value : '#000000', title: 'Pick a color' });
  text.addEventListener('input', () => {
    const v = text.value.trim();
    const ok = v === '' || colorRe.test(v);
    text.classList.toggle('invalid', !ok);
    if (ok) onSet(v);
    if (isHex6(v)) pick.value = v;
  });
  pick.addEventListener('input', () => {
    text.value = pick.value;
    text.classList.remove('invalid');
    onSet(pick.value);
  });
  const clear = el('button', {
    type: 'button', class: 'fmt-btn', textContent: '×', title: 'No color',
    onclick: () => {
      text.value = '';
      text.classList.remove('invalid');
      onSet('');
    },
  });
  return el('div', { class: 'color-field' }, text, pick, clear);
}

function numberField(value, min, max, placeholder, onSet) {
  const input = el('input', { type: 'number', min, max, value: value ?? '', placeholder });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (input.value === '') onSet('');
    else if (v >= min && v <= max) onSet(v);
  });
  return input;
}

// buildFormat returns the format section for node.
//   look: active field look; setLook(look) switches it
//   set(key, prop, value): stores one format value ('' or false removes it)
//   refresh(): rebuilds the panel (after toggles)
//   inherited: { font, size } the element inherits, shown when it has no own value (or null)
export function buildFormat({ node, look, setLook, rules, fonts, set, refresh, inherited }) {
  const key = fmtKeyFor(node, look);
  // cur() reads the live format; m is only used for the initial control values.
  const cur = () => (node.props && node.props[key]) || {};
  const m = cur();
  const put = (prop, value) => set(key, prop, value);
  const out = [];

  if (node.type === 'field') {
    // A dot marks the looks that have formatting.
    const used = (k) => node.props && node.props[k] && Object.keys(node.props[k]).length > 0;
    out.push(el('div', { class: 'segmented fmt-looks' }, ...fieldLooks.map(([k, label]) => el('button', {
      type: 'button', textContent: label + (used(k) ? ' •' : ''), class: k === look ? 'active' : '',
      title: used(k) ? 'Has formatting' : '',
      onclick: () => setLook(k),
    }))));
  }

  out.push(row('Align', ...[['left', '⇤', 'Left'], ['center', '↔', 'Center'], ['right', '⇥', 'Right']].map(([v, icon, title]) => toggle(icon, title, m.align === v, () => {
    put('align', cur().align === v ? '' : v);
    refresh();
  }))));
  out.push(row('Style',
    toggle('B', 'Bold', m.bold, () => { put('bold', !cur().bold); refresh(); }, 'b'),
    toggle('I', 'Italic', m.italic, () => { put('italic', !cur().italic); refresh(); }, 'i'),
    toggle('U', 'Underline', m.underline, () => { put('underline', !cur().underline); refresh(); }, 'u')));
  out.push(row('Color', colorField(m.color, rules.colorRe, (v) => put('color', v))));
  const inh = inherited || {};
  out.push(row('Size', numberField(m.size, 1, 200, inh.size ? `inherit: ${inh.size}` : 'px', (v) => put('size', v))));

  const fontSel = el('select', { onchange: () => put('font', fontSel.value) },
    el('option', { value: '', textContent: inh.font ? `(inherit: ${inh.font})` : '(inherit)' }),
    ...fonts.map((f) => el('option', { value: f, textContent: f })));
  if (m.font && !fonts.includes(m.font)) fontSel.append(el('option', { value: m.font, textContent: `${m.font} (not in font list)` }));
  fontSel.value = m.font || '';
  out.push(row('Font', fontSel));

  if (node.type === 'ul' || node.type === 'ol') {
    const styles = node.type === 'ul'
      ? [['disc', '● disc'], ['circle', '○ circle'], ['square', '■ square'], ['none', 'none']]
      : [['decimal', '1. 2. 3.'], ['decimal-leading-zero', '01. 02.'], ['lower-alpha', 'a. b. c.'], ['upper-alpha', 'A. B. C.'],
        ['lower-roman', 'i. ii. iii.'], ['upper-roman', 'I. II. III.'], ['none', 'none']];
    const ls = el('select', { onchange: () => put('listStyle', ls.value) },
      el('option', { value: '', textContent: '(default)' }),
      ...styles.map(([v, label]) => el('option', { value: v, textContent: label })));
    ls.value = m.listStyle || '';
    out.push(row(node.type === 'ul' ? 'Bullets' : 'Numbers', ls));
  }

  const box = boxKind(node, look);
  if (box !== 'none') {
    out.push(row('Background', colorField(m.bg, rules.colorRe, (v) => put('bg', v))));
  }
  if (box === 'full') {
    const styleSel = el('select', { onchange: () => put('borderStyle', styleSel.value) },
      ...['', 'solid', 'dashed', 'dotted', 'double', 'none'].map((v) => el('option', { value: v, textContent: v || '(none)' })));
    styleSel.value = m.borderStyle || '';
    out.push(row('Border', numberField(m.borderWidth, 0, 50, 'px', (v) => put('borderWidth', v)), styleSel));
    out.push(row('Border color', colorField(m.borderColor, rules.colorRe, (v) => put('borderColor', v))));
    out.push(row('Radius', numberField(m.radius, 0, 200, 'px', (v) => put('radius', v))));
  }

  out.push(el('div', { class: 'sel-actions' }, el('button', {
    type: 'button', textContent: 'Clear formatting',
    onclick: () => {
      for (const prop of Object.keys(cur())) put(prop, '');
      refresh();
    },
  })));
  return out;
}
