/* AnimLearn sandbox runtime.
 * Runs inside the sandboxed iframe (and inside the headless validator).
 * Provides: drawing helpers (h), theme palettes, the player message bridge,
 * and a layout inspector used to reject messy animations.
 * Plain browser JS on purpose: it is inlined into frame.html by the server.
 */
(function () {
  'use strict';

  var W = 960, H = 540, MARGIN = 40;
  var NS = 'http://www.w3.org/2000/svg';
  var FONT = "'Inter','Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif";
  var MONO = "'Cascadia Code','JetBrains Mono',Consolas,'SF Mono',Menlo,monospace";
  var SIZES = { title: 26, heading: 20, label: 17, body: 15, small: 13 };
  var WEIGHTS = { title: 700, heading: 650, label: 600, body: 400, small: 500 };
  var gsap = window.gsap;

  // ---------------------------------------------------------------- palettes
  var PALETTES = {
    light: {
      bg: '#f8fafc', surface: '#ffffff', surface2: '#f1f5f9', text: '#0f172a', textMuted: '#64748b', line: '#94a3b8',
      roles: {
        neutral: { fill: '#ffffff', stroke: '#94a3b8', text: '#0f172a', soft: '#f1f5f9' },
        active:  { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a', soft: '#eff6ff' },
        new:     { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d', soft: '#f0fdf4' },
        old:     { fill: '#fef3c7', stroke: '#d97706', text: '#78350f', soft: '#fffbeb' },
        danger:  { fill: '#fee2e2', stroke: '#dc2626', text: '#7f1d1d', soft: '#fef2f2' },
        accent:  { fill: '#ede9fe', stroke: '#7c3aed', text: '#4c1d95', soft: '#f5f3ff' },
        muted:   { fill: '#f1f5f9', stroke: '#cbd5e1', text: '#64748b', soft: '#f8fafc' }
      }
    },
    dark: {
      bg: '#0b1220', surface: '#111a2e', surface2: '#18233a', text: '#e2e8f0', textMuted: '#94a3b8', line: '#64748b',
      roles: {
        neutral: { fill: '#1e293b', stroke: '#64748b', text: '#e2e8f0', soft: '#111a2e' },
        active:  { fill: '#172554', stroke: '#60a5fa', text: '#dbeafe', soft: '#0f1a3a' },
        new:     { fill: '#052e16', stroke: '#4ade80', text: '#dcfce7', soft: '#06200f' },
        old:     { fill: '#3b2506', stroke: '#fbbf24', text: '#fef3c7', soft: '#2a1a05' },
        danger:  { fill: '#450a0a', stroke: '#f87171', text: '#fee2e2', soft: '#2c0808' },
        accent:  { fill: '#2e1065', stroke: '#a78bfa', text: '#ede9fe', soft: '#1e0b45' },
        muted:   { fill: '#162033', stroke: '#334155', text: '#94a3b8', soft: '#0f172a' }
      }
    }
  };

  // ---------------------------------------------------------------- state
  var theme = 'light';
  var pal = PALETTES.light;
  var root = null;           // <svg>
  var layers = null;         // { back, mid, front, top }
  var registry = [];         // every helper-made element, for the inspector
  var arrows = [];           // arrows/lines, for crossing checks
  var tl = null;             // current timeline
  var currentCode = null;
  var uid = 0;

  function role(name) {
    var r = pal.roles[name];
    if (!r) throw new Error('Unknown role "' + name + '". Use one of: ' + Object.keys(pal.roles).join(', '));
    return r;
  }

  // ---------------------------------------------------------------- dom utils
  function mk(tag, attrs, parent, style) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (style) for (var s in style) n.style[s] = style[s];
    if (parent) parent.appendChild(n);
    return n;
  }

  function register(el, kind, b, label, opts) {
    el.dataset.kind = kind;
    el.__b = { x: b.x, y: b.y, w: b.w, h: b.h };
    el.__label = label || kind;
    if (opts && opts.transient) el.dataset.transient = '1';
    registry.push(el);
    return el;
  }

  function bounds(el) {
    if (Array.isArray(el)) {
      var bs = el.map(bounds);
      var x1 = Math.min.apply(null, bs.map(function (b) { return b.x; }));
      var y1 = Math.min.apply(null, bs.map(function (b) { return b.y; }));
      var x2 = Math.max.apply(null, bs.map(function (b) { return b.x + b.w; }));
      var y2 = Math.max.apply(null, bs.map(function (b) { return b.y + b.h; }));
      return withDerived({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
    if (el && el.__b) return withDerived(el.__b);
    if (el && typeof el.x === 'number' && typeof el.y === 'number') return withDerived({ x: el.x, y: el.y, w: el.w || 0, h: el.h || 0 });
    throw new Error('h.bounds: expected an element created by a helper, or a {x,y} point');
  }

  function withDerived(b) {
    return { x: b.x, y: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2,
      left: b.x, right: b.x + b.w, top: b.y, bottom: b.y + b.h };
  }

  function anchor(el, side) {
    var b = bounds(el);
    switch (side) {
      case 'top': return { x: b.cx, y: b.top };
      case 'bottom': return { x: b.cx, y: b.bottom };
      case 'left': return { x: b.left, y: b.cy };
      case 'right': return { x: b.right, y: b.cy };
      default: return { x: b.cx, y: b.cy };
    }
  }

  // ---------------------------------------------------------------- text
  var measureCache = {};
  function measure(str, size, weight, family) {
    var key = str + '|' + size + '|' + weight + '|' + family;
    if (measureCache[key] != null) return measureCache[key];
    var t = mk('text', { x: -9999, y: -9999, 'font-size': size, 'font-weight': weight, 'font-family': family }, root);
    t.textContent = str;
    var w = t.getComputedTextLength();
    root.removeChild(t);
    measureCache[key] = w;
    return w;
  }

  function wrapLines(str, maxW, size, weight, family) {
    var out = [];
    String(str).split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean);
      var line = '';
      words.forEach(function (w) {
        var test = line ? line + ' ' + w : w;
        if (!maxW || measure(test, size, weight, family) <= maxW || !line) line = test;
        else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }

  /** Writes centered/anchored lines into a <text>. (x, cy) = anchor x and vertical center of the block. */
  function layoutText(t, lines, x, cy, size, lh) {
    while (t.firstChild) t.removeChild(t.firstChild);
    var total = lines.length * lh;
    lines.forEach(function (ln, i) {
      var ts = mk('tspan', { x: x, y: cy - total / 2 + lh / 2 + i * lh }, t);
      ts.textContent = ln;
    });
  }

  /** Fits text into maxW x maxH by wrapping, then shrinking (never below 12px). */
  function fitText(str, maxW, maxH, sizeName, weight, family) {
    var size = SIZES[sizeName] || sizeName || SIZES.label;
    var lines, lh, widest;
    for (;;) {
      lh = Math.round(size * 1.3);
      lines = wrapLines(str, maxW, size, weight, family);
      widest = Math.max.apply(null, lines.map(function (l) { return measure(l, size, weight, family); }));
      if ((lines.length * lh <= maxH && widest <= maxW) || size <= 12) break;
      size -= 1;
    }
    return { lines: lines, size: size, lh: lh, overflow: lines.length * lh > maxH + 2 || widest > maxW + 1, width: widest };
  }

  // ---------------------------------------------------------------- shapes
  function shapeNode(shape, x, y, w, h, r, parent) {
    var paint = { 'data-paint': 'shape' };
    var n;
    if (shape === 'circle') {
      n = mk('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }, parent);
    } else if (shape === 'pill') {
      n = mk('rect', { x: x, y: y, width: w, height: h, rx: h / 2 }, parent);
    } else if (shape === 'diamond') {
      n = mk('path', { d: 'M' + (x + w / 2) + ' ' + y + ' L' + (x + w) + ' ' + (y + h / 2) + ' L' + (x + w / 2) + ' ' + (y + h) + ' L' + x + ' ' + (y + h / 2) + ' Z' }, parent);
    } else if (shape === 'cylinder') {
      var ry = Math.min(12, h / 6);
      n = mk('path', { d: 'M' + x + ' ' + (y + ry) + ' A' + w / 2 + ' ' + ry + ' 0 0 1 ' + (x + w) + ' ' + (y + ry) +
        ' L' + (x + w) + ' ' + (y + h - ry) + ' A' + w / 2 + ' ' + ry + ' 0 0 1 ' + x + ' ' + (y + h - ry) + ' Z' }, parent);
      var lid = mk('path', { d: 'M' + x + ' ' + (y + ry) + ' A' + w / 2 + ' ' + ry + ' 0 0 0 ' + (x + w) + ' ' + (y + ry), fill: 'none' }, parent);
      lid.dataset.paint = 'stroke';
    } else {
      n = mk('rect', { x: x, y: y, width: w, height: h, rx: r == null ? 10 : r }, parent);
    }
    for (var k in paint) n.setAttribute(k, paint[k]);
    return n;
  }

  function applyRole(g, roleName) {
    var r = role(roleName);
    g.dataset.role = roleName;
    paintTargets(g).forEach(function (p) {
      var st = paintStyle(p.dataset.paint, r);
      for (var k in st) p.style[k] = st[k];
    });
  }

  function paintTargets(g) {
    var list = Array.prototype.slice.call(g.querySelectorAll('[data-paint]'));
    if (g.dataset && g.dataset.paint) list.unshift(g);
    return list;
  }

  function paintStyle(kind, r) {
    switch (kind) {
      case 'shape': return { fill: r.fill, stroke: r.stroke };
      case 'stroke': return { stroke: r.stroke };
      case 'head': return { fill: r.stroke };
      case 'label': return { fill: r.text };
      case 'soft': return { fill: r.soft, stroke: r.stroke };
      case 'ink': return { fill: r.stroke };
      default: return {};
    }
  }

  /** h.box: a labelled shape. (x, y) is the top-left corner. */
  function box(o) {
    o = o || {};
    var x = num(o.x, 'box.x'), y = num(o.y, 'box.y');
    var w = o.w || 160, h = o.h || 64, shape = o.shape || 'rect';
    var g = mk('g', null, layers.front);
    shapeNode(shape, x, y, w, h, o.radius, g).style.strokeWidth = o.strokeWidth || 2;
    if (o.dashed) g.firstChild.style.strokeDasharray = '6 5';
    var padX = shape === 'circle' || shape === 'diamond' ? w * 0.2 : 12;
    var innerW = w - padX * 2;
    var subH = o.sub ? 20 : 0;
    var weight = WEIGHTS.label;
    if (o.label != null && o.label !== '') {
      var fit = fitText(String(o.label), innerW, h - 12 - subH, o.size || 'label', weight, FONT);
      var t = mk('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': FONT,
        'font-size': fit.size, 'font-weight': weight, 'data-paint': 'label' }, g);
      layoutText(t, fit.lines, x + w / 2, y + h / 2 - subH / 2, fit.size, fit.lh);
      t.__fit = { maxW: innerW, maxH: h - 12 - subH, sizeName: o.size || 'label', weight: weight, family: FONT, x: x + w / 2, cy: y + h / 2 - subH / 2 };
      if (fit.overflow) t.dataset.overflow = String(Math.round(w));
      g.__text = t;
    }
    if (o.sub) {
      var sf = fitText(String(o.sub), innerW, 18, 'small', WEIGHTS.small, FONT);
      var s = mk('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': FONT,
        'font-size': sf.size, 'font-weight': WEIGHTS.small }, g, { fill: pal.textMuted });
      layoutText(s, sf.lines.slice(0, 1), x + w / 2, y + h / 2 + (o.label ? 13 : 0), sf.size, sf.lh);
      if (sf.overflow || sf.lines.length > 1) s.dataset.overflow = String(Math.round(w));
      g.__sub = s;
    }
    applyRole(g, o.role || 'neutral');
    return register(g, 'box', { x: x, y: y, w: w, h: h }, o.label || o.sub || 'box');
  }

  /** h.container: a labelled region that groups other elements. */
  function container(o) {
    var x = num(o.x, 'container.x'), y = num(o.y, 'container.y'), w = num(o.w, 'container.w'), h = num(o.h, 'container.h');
    var g = mk('g', null, layers.back);
    var rect = mk('rect', { x: x, y: y, width: w, height: h, rx: 14, 'data-paint': 'soft' }, g, { strokeWidth: 1.5, strokeDasharray: o.solid ? null : '6 5' });
    void rect;
    if (o.label) {
      var t = mk('text', { x: x + 16, y: y + 22, 'dominant-baseline': 'central', 'font-family': FONT, 'font-size': SIZES.small,
        'font-weight': 700, 'letter-spacing': '0.06em', 'data-paint': 'ink' }, g);
      // Uppercase plain words only; keep code-like labels (<div>, app.js) as written.
      t.textContent = /[<>{}\/=_]|\w\.\w/.test(String(o.label)) ? String(o.label) : String(o.label).toUpperCase();
      if (measure(t.textContent, SIZES.small, 700, FONT) * 1.06 > w - 32) t.dataset.overflow = String(Math.round(w));
      t.__fit = { maxW: w - 32, sizeName: 'small', weight: 700, family: FONT, x: x + 16, cy: y + 22, fixedSize: SIZES.small };
      g.__text = t;
    }
    applyRole(g, o.role || 'neutral');
    register(g, 'container', { x: x, y: y, w: w, h: h }, o.label || 'container');
    g.inner = { x: x + 20, y: y + (o.label ? 44 : 20), w: w - 40, h: h - (o.label ? 64 : 40) };
    return g;
  }

  /** h.text: free text. (x, y) is the anchor x and the TOP of the text block. */
  function text(o) {
    var sizeName = o.size || 'body';
    var size = SIZES[sizeName] || SIZES.body;
    var weight = o.weight || WEIGHTS[sizeName] || 400;
    var family = o.mono ? MONO : FONT;
    var lines = wrapLines(String(o.text), o.maxWidth || 0, size, weight, family);
    var lh = Math.round(size * 1.35);
    var anchorName = o.anchor || 'start';
    var t = mk('text', { 'text-anchor': anchorName, 'dominant-baseline': 'central', 'font-family': family,
      'font-size': size, 'font-weight': weight }, layers.front);
    var cy = num(o.y, 'text.y') + (lines.length * lh) / 2;
    layoutText(t, lines, num(o.x, 'text.x'), cy, size, lh);
    t.__fit = { maxW: o.maxWidth || 0, sizeName: sizeName, weight: weight, family: family, x: o.x, cy: cy, fixedSize: size };
    if (o.role) { t.setAttribute('data-paint', 'ink'); t.style.fill = role(o.role).stroke; t.dataset.role = o.role; }
    else t.style.fill = o.muted ? pal.textMuted : pal.text;
    var widest = Math.max.apply(null, lines.map(function (l) { return measure(l, size, weight, family); }));
    var bx = anchorName === 'middle' ? o.x - widest / 2 : anchorName === 'end' ? o.x - widest : o.x;
    return register(t, 'text', { x: bx, y: o.y, w: widest, h: lines.length * lh }, o.text);
  }

  /** h.code: a code block. Returns group with .lines[i] (text) and line highlight support. */
  function code(o) {
    var x = num(o.x, 'code.x'), y = num(o.y, 'code.y'), w = o.w || 360;
    var lines = o.lines || [];
    var size = 14, lh = 24, pad = 14, titleH = o.title ? 30 : 0;
    var h = titleH + pad * 2 + lines.length * lh - 4;
    var g = mk('g', null, layers.front);
    mk('rect', { x: x, y: y, width: w, height: h, rx: 10 }, g, { fill: pal.surface2, stroke: pal.line, strokeWidth: 1.5 });
    if (o.title) {
      var tt = mk('text', { x: x + pad, y: y + 18, 'dominant-baseline': 'central', 'font-family': FONT, 'font-size': SIZES.small, 'font-weight': 700 }, g, { fill: pal.textMuted });
      tt.textContent = o.title;
      mk('line', { x1: x, x2: x + w, y1: y + titleH, y2: y + titleH }, g, { stroke: pal.line, strokeWidth: 1, opacity: 0.6 });
    }
    g.lines = []; g.marks = [];
    lines.forEach(function (ln, i) {
      var ly = y + titleH + pad + i * lh;
      var mark = mk('rect', { x: x + 4, y: ly - 3, width: w - 8, height: lh - 2, rx: 5 }, g, { fill: role('active').fill, opacity: 0 });
      var t = mk('text', { x: x + pad, y: ly + (lh - 4) / 2, 'dominant-baseline': 'central', 'font-family': MONO, 'font-size': size, 'xml:space': 'preserve' }, g, { fill: pal.text, whiteSpace: 'pre' });
      t.textContent = ln;
      if (measure(ln, size, 400, MONO) > w - pad * 2) t.dataset.overflow = String(Math.round(w));
      g.lines.push(t); g.marks.push(mark);
    });
    return register(g, 'code', { x: x, y: y, w: w, h: h }, o.title || 'code');
  }

  /** h.note: a short callout with an accent bar. Height is automatic. */
  function note(o) {
    var x = num(o.x, 'note.x'), y = num(o.y, 'note.y'), w = o.w || 260;
    var size = SIZES.body, lh = Math.round(size * 1.4);
    var lines = wrapLines(String(o.text), w - 32, size, 400, FONT);
    var h = lines.length * lh + 20;
    var g = mk('g', null, layers.front);
    var r = role(o.role || 'accent');
    mk('rect', { x: x, y: y, width: w, height: h, rx: 8 }, g, { fill: pal.surface, stroke: pal.line, strokeWidth: 1 });
    mk('rect', { x: x, y: y, width: 4, height: h, rx: 2, 'data-paint': 'head' }, g);
    var t = mk('text', { 'dominant-baseline': 'central', 'font-family': FONT, 'font-size': size }, g, { fill: pal.text });
    layoutText(t, lines, x + 18, y + h / 2, size, lh);
    void r;
    applyRole(g, o.role || 'accent');
    return register(g, 'note', { x: x, y: y, w: w, h: h }, o.text);
  }

  /** h.token: small moving thing (data packet, message, request). */
  function token(o) {
    var r = o.r || 14;
    var g = mk('g', null, layers.top);
    var w, h;
    if (o.label) {
      var size = SIZES.small;
      w = Math.max(measure(String(o.label), size, 600, FONT) + 22, 2 * r);
      h = 26;
      mk('rect', { x: o.x - w / 2, y: o.y - h / 2, width: w, height: h, rx: h / 2, 'data-paint': 'shape' }, g, { strokeWidth: 2 });
      var t = mk('text', { x: o.x, y: o.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': FONT,
        'font-size': size, 'font-weight': 600, 'data-paint': 'label' }, g);
      t.textContent = o.label;
    } else {
      w = h = 2 * r;
      mk('circle', { cx: o.x, cy: o.y, r: r, 'data-paint': 'shape' }, g, { strokeWidth: 2 });
    }
    applyRole(g, o.role || 'accent');
    return register(g, 'token', { x: o.x - w / 2, y: o.y - h / 2, w: w, h: h }, o.label || 'token', { transient: !!o.transient });
  }

  // ---------------------------------------------------------------- connectors
  function edgePoint(target, toward, gap, side) {
    if (side) {
      var a = anchor(target, side);
      var d = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
      return { x: a.x + d[0] * gap, y: a.y + d[1] * gap };
    }
    if (!target.__b && typeof target.x === 'number') return { x: target.x, y: target.y };
    var b = bounds(target);
    var dx = toward.x - b.cx, dy = toward.y - b.cy;
    if (dx === 0 && dy === 0) return { x: b.cx, y: b.cy };
    var isRound = target.querySelector && target.querySelector('ellipse');
    var t;
    if (isRound) {
      t = 1 / Math.sqrt((dx * dx) / ((b.w / 2) * (b.w / 2)) + (dy * dy) / ((b.h / 2) * (b.h / 2)));
    } else {
      t = Math.min(dx !== 0 ? (b.w / 2) / Math.abs(dx) : Infinity, dy !== 0 ? (b.h / 2) / Math.abs(dy) : Infinity);
    }
    var len = Math.sqrt(dx * dx + dy * dy);
    return { x: b.cx + dx * t + (dx / len) * gap, y: b.cy + dy * t + (dy / len) * gap };
  }

  function centerOf(t) { return t.__b ? anchor(t) : { x: t.x, y: t.y }; }

  /** h.arrow(from, to, opts): from/to are elements or {x,y} points. */
  function arrow(from, to, o) {
    o = o || {};
    var gap = o.gap == null ? 6 : o.gap;
    var c1 = o.fromSide ? anchor(from, o.fromSide) : centerOf(from);
    var c2 = o.toSide ? anchor(to, o.toSide) : centerOf(to);
    var p1 = edgePoint(from, c2, gap, o.fromSide);
    var p2 = edgePoint(to, c1, gap, o.toSide);
    var bend = o.bend || 0;
    var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    var dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var cx = mx + nx * bend, cy = my + ny * bend;
    // shorten the line so it ends at the base of the arrow head
    var headLen = o.head === false ? 0 : 11;
    var tx = p2.x - cx, ty = p2.y - cy, tl2 = Math.sqrt(tx * tx + ty * ty) || 1;
    var ex = p2.x - (tx / tl2) * headLen, ey = p2.y - (ty / tl2) * headLen;
    var g = mk('g', null, layers.mid);
    var d = bend ? 'M' + p1.x + ' ' + p1.y + ' Q' + cx + ' ' + cy + ' ' + ex + ' ' + ey : 'M' + p1.x + ' ' + p1.y + ' L' + ex + ' ' + ey;
    var path = mk('path', { d: d, fill: 'none', 'data-paint': 'stroke', 'stroke-linecap': 'round' }, g, { strokeWidth: o.width || 2.25 });
    if (o.dashed) path.style.strokeDasharray = '7 6';
    g.__path = path;
    if (headLen) {
      var ux = tx / tl2, uy = ty / tl2;
      var hw = 6.5;
      var head = mk('path', { d: 'M' + p2.x + ' ' + p2.y + ' L' + (ex - uy * hw) + ' ' + (ey + ux * hw) + ' L' + (ex + uy * hw) + ' ' + (ey - ux * hw) + ' Z', 'data-paint': 'head' }, g);
      g.__head = head;
    }
    if (o.label) {
      var lx = bend ? 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x : mx;
      var ly = bend ? 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y : my;
      var off = o.labelOffset || 0;
      lx += nx * off; ly += ny * off;
      var size = SIZES.small;
      var tw = measure(String(o.label), size, 600, FONT);
      var lg = mk('g', null, g);
      mk('rect', { x: lx - tw / 2 - 8, y: ly - 12, width: tw + 16, height: 24, rx: 12 }, lg, { fill: pal.bg, stroke: 'none' });
      var t = mk('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': FONT,
        'font-size': size, 'font-weight': 600, 'data-paint': 'label' }, lg);
      t.textContent = o.label;
      var segLen = Math.sqrt(Math.pow(ex - p1.x, 2) + Math.pow(ey - p1.y, 2));
      if (segLen < tw + 48) t.dataset.short = String(Math.round(segLen));
      g.__labelEl = lg;
    }
    applyRole(g, o.role || 'neutral');
    // labels on neutral arrows read better in the normal text color
    if (o.label && (o.role || 'neutral') === 'neutral') g.__labelEl.lastChild.style.fill = pal.textMuted;
    g.__from = from.__b ? from : null; g.__to = to.__b ? to : null;
    arrows.push(g);
    var bx = Math.min(p1.x, p2.x, cx), by = Math.min(p1.y, p2.y, cy);
    return register(g, 'arrow', { x: bx, y: by, w: Math.max(p1.x, p2.x, cx) - bx, h: Math.max(p1.y, p2.y, cy) - by }, o.label || 'arrow');
  }

  /** h.line: a connector without a head (e.g. tree edges). */
  function line(from, to, o) {
    o = o || {};
    var opts = {}; for (var k in o) opts[k] = o[k];
    opts.head = false;
    if (opts.gap == null) opts.gap = 0;
    return arrow(from, to, opts);
  }

  // ---------------------------------------------------------------- layouts
  function row(o) {
    var items = o.items || [];
    var n = items.length, gap = o.gap == null ? 24 : o.gap;
    var w = o.w || (W - 2 * MARGIN);
    var itemW = o.itemW || (w - gap * (n - 1)) / n;
    var total = itemW * n + gap * (n - 1);
    var x0 = (o.x == null ? MARGIN : o.x) + (w - total) / 2;
    return items.map(function (it, i) {
      return box(assign({ x: x0 + i * (itemW + gap), y: o.y, w: itemW, h: o.h || 64, role: o.role, shape: o.shape }, it));
    });
  }

  function column(o) {
    var items = o.items || [];
    var gap = o.gap == null ? 16 : o.gap, ih = o.itemH || 56;
    return items.map(function (it, i) {
      return box(assign({ x: o.x, y: o.y + i * (ih + gap), w: o.w || 200, h: ih, role: o.role, shape: o.shape }, it));
    });
  }

  /** h.tree({x,y,w,h,root:{label,id?,role?,children:[]},nodeW,nodeH}) */
  function tree(o) {
    var nodeW = o.nodeW || 120, nodeH = o.nodeH || 48;
    var levels = [];
    function leaves(n) { return n.children && n.children.length ? n.children.reduce(function (s, c) { return s + leaves(c); }, 0) : 1; }
    function depth(n) { return 1 + (n.children && n.children.length ? Math.max.apply(null, n.children.map(depth)) : 0); }
    var totalLeaves = leaves(o.root), d = depth(o.root);
    var slot = o.w / totalLeaves;
    nodeW = Math.min(nodeW, slot - 16);
    var levelGap = d > 1 ? (o.h - nodeH) / (d - 1) : 0;
    var nodes = {}, edges = {}, all = [], edgeList = [];
    function place(n, x0, lvl, parent) {
      var span = leaves(n) * slot;
      var cx = o.x + x0 + span / 2;
      var el = box({ x: cx - nodeW / 2, y: o.y + lvl * levelGap, w: nodeW, h: nodeH, label: n.label, sub: n.sub, role: n.role || o.role || 'neutral', shape: n.shape });
      var key = n.id || n.label;
      nodes[key] = el; all.push(el);
      (levels[lvl] = levels[lvl] || []).push(el);
      if (parent) {
        var e = line(parent, el, { fromSide: 'bottom', toSide: 'top', role: o.edgeRole || 'neutral' });
        edges[key] = e; edgeList.push(e);
      }
      var cx0 = x0;
      (n.children || []).forEach(function (c) { place(c, cx0, lvl + 1, el); cx0 += leaves(c) * slot; });
    }
    place(o.root, 0, 0, null);
    return { nodes: nodes, edges: edges, all: all, edgeList: edgeList, levels: levels };
  }

  // ---------------------------------------------------------------- icons
  var ICONS = {
    user: function (g, s) { mk('circle', { cx: s / 2, cy: s * 0.33, r: s * 0.18 }, g); mk('path', { d: 'M' + s * 0.18 + ' ' + s * 0.9 + ' C' + s * 0.18 + ' ' + s * 0.6 + ' ' + s * 0.82 + ' ' + s * 0.6 + ' ' + s * 0.82 + ' ' + s * 0.9 }, g); },
    file: function (g, s) { mk('path', { d: 'M' + s * 0.22 + ' ' + s * 0.08 + ' H' + s * 0.6 + ' L' + s * 0.8 + ' ' + s * 0.28 + ' V' + s * 0.92 + ' H' + s * 0.22 + ' Z M' + s * 0.6 + ' ' + s * 0.08 + ' V' + s * 0.28 + ' H' + s * 0.8 }, g); },
    database: function (g, s) { mk('ellipse', { cx: s / 2, cy: s * 0.22, rx: s * 0.32, ry: s * 0.11 }, g); mk('path', { d: 'M' + s * 0.18 + ' ' + s * 0.22 + ' V' + s * 0.78 + ' A' + s * 0.32 + ' ' + s * 0.11 + ' 0 0 0 ' + s * 0.82 + ' ' + s * 0.78 + ' V' + s * 0.22 + ' M' + s * 0.18 + ' ' + s * 0.5 + ' A' + s * 0.32 + ' ' + s * 0.11 + ' 0 0 0 ' + s * 0.82 + ' ' + s * 0.5 }, g); },
    server: function (g, s) { [0.12, 0.54].forEach(function (y) { mk('rect', { x: s * 0.14, y: s * y, width: s * 0.72, height: s * 0.34, rx: s * 0.06 }, g); mk('circle', { cx: s * 0.28, cy: s * (y + 0.17), r: s * 0.035 }, g); }); },
    browser: function (g, s) { mk('rect', { x: s * 0.08, y: s * 0.16, width: s * 0.84, height: s * 0.68, rx: s * 0.07 }, g); mk('path', { d: 'M' + s * 0.08 + ' ' + s * 0.34 + ' H' + s * 0.92 }, g); },
    package: function (g, s) { mk('path', { d: 'M' + s / 2 + ' ' + s * 0.08 + ' L' + s * 0.88 + ' ' + s * 0.28 + ' V' + s * 0.72 + ' L' + s / 2 + ' ' + s * 0.92 + ' L' + s * 0.12 + ' ' + s * 0.72 + ' V' + s * 0.28 + ' Z M' + s * 0.12 + ' ' + s * 0.28 + ' L' + s / 2 + ' ' + s * 0.48 + ' L' + s * 0.88 + ' ' + s * 0.28 + ' M' + s / 2 + ' ' + s * 0.48 + ' V' + s * 0.92 }, g); },
    terminal: function (g, s) { mk('rect', { x: s * 0.08, y: s * 0.16, width: s * 0.84, height: s * 0.68, rx: s * 0.07 }, g); mk('path', { d: 'M' + s * 0.24 + ' ' + s * 0.38 + ' L' + s * 0.4 + ' ' + s * 0.5 + ' L' + s * 0.24 + ' ' + s * 0.62 + ' M' + s * 0.46 + ' ' + s * 0.64 + ' H' + s * 0.7 }, g); },
    cloud: function (g, s) { mk('path', { d: 'M' + s * 0.28 + ' ' + s * 0.76 + ' H' + s * 0.74 + ' A' + s * 0.17 + ' ' + s * 0.17 + ' 0 0 0 ' + s * 0.72 + ' ' + s * 0.42 + ' A' + s * 0.24 + ' ' + s * 0.24 + ' 0 0 0 ' + s * 0.27 + ' ' + s * 0.46 + ' A' + s * 0.15 + ' ' + s * 0.15 + ' 0 0 0 ' + s * 0.28 + ' ' + s * 0.76 + ' Z' }, g); },
    gear: function (g, s) { mk('circle', { cx: s / 2, cy: s / 2, r: s * 0.14 }, g); for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; mk('path', { d: 'M' + (s / 2 + Math.cos(a) * s * 0.24) + ' ' + (s / 2 + Math.sin(a) * s * 0.24) + ' L' + (s / 2 + Math.cos(a) * s * 0.38) + ' ' + (s / 2 + Math.sin(a) * s * 0.38) }, g); } mk('circle', { cx: s / 2, cy: s / 2, r: s * 0.26 }, g); },
    lock: function (g, s) { mk('rect', { x: s * 0.2, y: s * 0.44, width: s * 0.6, height: s * 0.46, rx: s * 0.06 }, g); mk('path', { d: 'M' + s * 0.32 + ' ' + s * 0.44 + ' V' + s * 0.3 + ' A' + s * 0.18 + ' ' + s * 0.18 + ' 0 0 1 ' + s * 0.68 + ' ' + s * 0.3 + ' V' + s * 0.44 }, g); },
    cpu: function (g, s) { mk('rect', { x: s * 0.24, y: s * 0.24, width: s * 0.52, height: s * 0.52, rx: s * 0.06 }, g); [0.38, 0.5, 0.62].forEach(function (p) { mk('path', { d: 'M' + s * p + ' ' + s * 0.1 + ' V' + s * 0.24 + ' M' + s * p + ' ' + s * 0.76 + ' V' + s * 0.9 + ' M' + s * 0.1 + ' ' + s * p + ' H' + s * 0.24 + ' M' + s * 0.76 + ' ' + s * p + ' H' + s * 0.9 }, g); }); }
  };

  function icon(name, o) {
    var draw = ICONS[name];
    if (!draw) throw new Error('Unknown icon "' + name + '". Available: ' + Object.keys(ICONS).join(', '));
    var s = o.size || 32;
    var g = mk('g', { transform: 'translate(' + o.x + ' ' + o.y + ')' }, layers.front);
    var inner = mk('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-paint': 'stroke' }, g, { strokeWidth: Math.max(1.6, s / 16) });
    draw(inner, s);
    applyRole(g, o.role || 'neutral');
    return register(g, 'icon', { x: o.x, y: o.y, w: s, h: s }, name);
  }

  // ---------------------------------------------------------------- animation helpers
  function arr(x) { return Array.isArray(x) ? x : [x]; }
  function pos(at) { return at === undefined ? '>' : at; }

  function timeline() {
    tl = gsap.timeline({ paused: true, defaults: { duration: 0.8, ease: 'power2.inOut' } });
    return tl;
  }

  function reveal(t, targets, at, o) {
    o = o || {};
    var list = arr(targets);
    var stagger = o.stagger == null ? 0.15 : o.stagger;
    var from = o.from || 'fade';
    var p = pos(at);
    list.forEach(function (el, i) {
      var at2 = i === 0 ? p : '<' + stagger;
      if (el.dataset && el.dataset.kind === 'arrow') { draw(t, el, at2, o); return; }
      var vars0 = { opacity: 0 }, vars1 = { opacity: 1, duration: o.duration || 0.7, ease: 'power2.out' };
      if (from === 'up') { vars0.y = 14; vars1.y = 0; }
      if (from === 'down') { vars0.y = -14; vars1.y = 0; }
      if (from === 'left') { vars0.x = -18; vars1.x = 0; }
      if (from === 'scale') { vars0.scale = 0.85; vars1.scale = 1; vars0.transformOrigin = vars1.transformOrigin = '50% 50%'; vars1.ease = 'back.out(1.4)'; }
      t.fromTo(el, vars0, vars1, at2);
    });
    return t;
  }

  function hide(t, targets, at, o) {
    o = o || {};
    t.to(arr(targets), { opacity: o.to == null ? 0 : o.to, duration: o.duration || 0.6, stagger: o.stagger || 0, ease: 'power2.inOut' }, pos(at));
    return t;
  }

  function dim(t, targets, at, o) { return hide(t, targets, at, { to: 0.3, duration: (o && o.duration) || 0.6 }); }
  function undim(t, targets, at, o) { t.to(arr(targets), { opacity: 1, duration: (o && o.duration) || 0.6 }, pos(at)); return t; }

  function draw(t, el, at, o) {
    o = o || {};
    var path = el.__path;
    if (!path) throw new Error('h.draw expects an arrow or line made with h.arrow / h.line');
    var len = path.getTotalLength();
    var dur = o.duration || Math.min(1.2, Math.max(0.6, len / 300));
    var dashed = path.style.strokeDasharray && path.style.strokeDasharray !== 'none';
    var p = pos(at);
    // The arrow group may have been hidden with gsap.set(opacity 0): bring it back as it draws.
    t.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, p);
    if (dashed) {
      t.fromTo(path, { opacity: 0 }, { opacity: 1, duration: dur * 0.8, ease: 'power2.out' }, '<');
    } else {
      t.fromTo(path, { strokeDasharray: len + ' ' + len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut' }, '<');
    }
    if (el.__head) t.fromTo(el.__head, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, '>-0.15');
    if (el.__labelEl) t.fromTo(el.__labelEl, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out' }, '<');
    return t;
  }

  function recolor(t, targets, roleName, at, o) {
    o = o || {};
    var r = role(roleName);
    var p = pos(at);
    arr(targets).forEach(function (el, i) {
      paintTargets(el).forEach(function (n, j) {
        var vars = paintStyle(n.dataset.paint, r);
        vars.duration = o.duration || 0.7;
        vars.ease = 'power2.inOut';
        t.to(n, vars, i === 0 && j === 0 ? p : '<');
      });
    });
    return t;
  }

  function pulse(t, targets, at, o) {
    o = o || {};
    t.to(arr(targets), { scale: o.scale || 1.06, transformOrigin: '50% 50%', duration: 0.35, yoyo: true, repeat: (o.times || 1) * 2 - 1, ease: 'sine.inOut' }, pos(at));
    return t;
  }

  function moveTo(t, el, target, at, o) {
    o = o || {};
    var b = bounds(el);
    var vars = { duration: o.duration || 1, ease: o.ease || 'power3.inOut' };
    if (target.x != null) vars.x = target.x - b.x;
    if (target.y != null) vars.y = target.y - b.y;
    t.to(el, vars, pos(at));
    return t;
  }

  function moveBy(t, el, d, at, o) {
    o = o || {};
    t.to(el, { x: '+=' + (d.dx || 0), y: '+=' + (d.dy || 0), duration: o.duration || 1, ease: o.ease || 'power3.inOut' }, pos(at));
    return t;
  }

  function highlight(t, target, at, o) {
    o = o || {};
    var b = bounds(target), pad = o.pad == null ? 8 : o.pad;
    var g = mk('g', null, layers.top);
    mk('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, rx: 14, fill: 'none', 'data-paint': 'stroke' }, g, { strokeWidth: 3 });
    applyRole(g, o.role || 'active');
    register(g, 'ring', { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, 'highlight', { transient: true });
    t.fromTo(g, { opacity: 0, scale: 1.04, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power2.out' }, pos(at));
    return g;
  }

  function highlightLine(t, codeEl, i, at, o) {
    o = o || {};
    var m = codeEl.marks && codeEl.marks[i];
    if (!m) throw new Error('h.highlightLine: code block has no line ' + i);
    m.style.fill = role(o.role || 'active').fill;
    var p = pos(at);
    t.to(m, { opacity: 1, duration: 0.5 }, p);
    // Only one highlighted line at a time, unless { keep: true }.
    var prev = codeEl.__hl;
    if (prev != null && prev !== i && !(o && o.keep)) t.to(codeEl.marks[prev], { opacity: 0, duration: 0.5 }, '<');
    codeEl.__hl = i;
    return m;
  }

  /** Moves a token from one element to another (or along an arrow with {along: arrow}). */
  function flow(t, from, to, at, o) {
    o = o || {};
    var path = o.along && o.along.__path;
    var start = path ? path.getPointAtLength(0) : centerOf(from);
    var tk = token({ x: start.x, y: start.y, label: o.label, role: o.role || 'accent', transient: true, r: o.r });
    var dur = o.duration || 1.4;
    var p = pos(at);
    t.fromTo(tk, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out' }, p);
    if (path) {
      var len = path.getTotalLength();
      var proxy = { d: 0 };
      t.fromTo(proxy, { d: 0 }, { d: 1, duration: dur, ease: 'power1.inOut', onUpdate: function () {
        var pt = path.getPointAtLength(proxy.d * len);
        gsap.set(tk, { x: pt.x - start.x, y: pt.y - start.y });
      } }, '>');
    } else {
      var end = centerOf(to);
      t.fromTo(tk, { x: 0, y: 0 }, { x: end.x - start.x, y: end.y - start.y, duration: dur, ease: 'power1.inOut' }, '>');
    }
    if (!o.keep) t.to(tk, { opacity: 0, duration: 0.3, ease: 'power1.in' }, '>');
    return tk;
  }

  /** Cross-fades the label of a box (or a h.text) to new text. */
  function swapText(t, el, newText, at, o) {
    o = o || {};
    var old = el.__text || (el.tagName === 'text' ? el : null);
    if (!old || !old.__fit) throw new Error('h.swapText expects a box/container/text made by a helper');
    var f = old.__fit;
    var clone = old.cloneNode(false);
    var fit = f.fixedSize ? { lines: wrapLines(String(newText), f.maxW, f.fixedSize, f.weight, f.family), size: f.fixedSize, lh: Math.round(f.fixedSize * 1.35) }
      : fitText(String(newText), f.maxW, f.maxH, f.sizeName, f.weight, f.family);
    clone.setAttribute('font-size', fit.size);
    clone.removeAttribute('data-overflow');
    if (fit.overflow) clone.dataset.overflow = old.dataset.overflow || '1';
    layoutText(clone, fit.lines, f.x, f.cy, fit.size, fit.lh);
    clone.__fit = f;
    old.parentNode.appendChild(clone);
    clone.style.fill = old.style.fill;
    var p = pos(at);
    var d = o.duration || 0.5;
    t.fromTo(old, { opacity: 1 }, { opacity: 0, duration: d, ease: 'power1.inOut' }, p);
    t.fromTo(clone, { opacity: 0 }, { opacity: 1, duration: d, ease: 'power1.inOut' }, '<');
    if (el.__text) el.__text = clone;
    return clone;
  }

  function wait(t, seconds) { t.to({}, { duration: seconds }); return t; }

  function num(v, name) {
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(name + ' must be a number (got ' + v + ')');
    return v;
  }
  function assign(a, b) { var o = {}; for (var k in a) if (a[k] !== undefined) o[k] = a[k]; for (var j in b) if (b[j] !== undefined) o[j] = b[j]; return o; }

  var h = {
    W: W, H: H, MARGIN: MARGIN,
    box: box, container: container, text: text, code: code, note: note, token: token, icon: icon,
    arrow: arrow, line: line, row: row, column: column, tree: tree,
    bounds: bounds, anchor: anchor,
    color: function (r, part) { return role(r)[part || 'stroke']; },
    get pal() { return pal; },
    timeline: timeline, reveal: reveal, hide: hide, dim: dim, undim: undim, draw: draw, recolor: recolor,
    pulse: pulse, moveTo: moveTo, moveBy: moveBy, highlight: highlight, highlightLine: highlightLine,
    flow: flow, swapText: swapText, wait: wait
  };

  // ---------------------------------------------------------------- rendering
  function applyTheme(name) {
    theme = name === 'dark' ? 'dark' : 'light';
    pal = PALETTES[theme];
    document.documentElement.style.background = pal.bg;
    document.body.style.background = pal.bg;
  }

  function setup() {
    var stage = document.getElementById('stage');
    if (tl) { tl.kill(); tl = null; }
    stage.innerHTML = '';
    registry = []; arrows = []; measureCache = {}; uid = 0;
    root = mk('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'img' }, stage);
    root.style.fontFamily = FONT;
    layers = { back: mk('g', { id: 'layer-back' }, root), mid: mk('g', { id: 'layer-mid' }, root),
      front: mk('g', { id: 'layer-front' }, root), top: mk('g', { id: 'layer-top' }, root) };
  }

  /** Runs generated code. Returns { ok, duration } or { ok:false, error }. */
  function run(codeStr, themeName) {
    applyTheme(themeName || theme);
    setup();
    currentCode = codeStr;
    try {
      var fn = new Function('ctx', '"use strict";\nvar svg = ctx.svg, gsap = ctx.gsap, h = ctx.h, W = ctx.W, H = ctx.H;\n' + codeStr);
      var result = fn({ svg: root, gsap: gsap, h: h, W: W, H: H });
      if (!result || typeof result.duration !== 'function' || typeof result.progress !== 'function') {
        throw new Error('render() must return the gsap timeline (e.g. `const tl = h.timeline(); ... return tl;`)');
      }
      tl = result;
      tl.pause();
      var shapes = registry.filter(function (e) { return !e.dataset.transient; }).length;
      if (shapes < 3) throw new Error('The scene renders almost nothing (' + shapes + ' elements). Draw the scene with the h.* helpers.');
      if (tl.duration() < 1) throw new Error('The timeline is only ' + tl.duration().toFixed(2) + 's long. Steps should animate for 5–14 seconds.');
      return { ok: true, duration: tl.duration() };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  // ---------------------------------------------------------------- inspector (used by the validator)
  function effectiveOpacity(n) {
    var o = 1;
    while (n && n !== root) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity);
      n = n.parentNode;
    }
    return o;
  }

  function toVB(r) {
    var m = root.getScreenCTM().inverse();
    var p1 = new DOMPoint(r.left, r.top).matrixTransform(m);
    var p2 = new DOMPoint(r.right, r.bottom).matrixTransform(m);
    return { x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y };
  }

  function isTransient(n) {
    while (n && n !== root) { if (n.dataset && n.dataset.transient) return true; n = n.parentNode; }
    return false;
  }

  function snapshot() {
    var out = { texts: [], boxes: [], arrows: [] };
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      if (isTransient(t) || !t.textContent.trim()) return;
      var op = effectiveOpacity(t);
      if (op < 0.15) return;
      var owner = null, n = t.parentNode;
      while (n && n !== root) { if (n.dataset && n.dataset.kind) { owner = n; break; } n = n.parentNode; }
      out.texts.push({ el: t, label: t.textContent.trim().slice(0, 40), r: toVB(t.getBoundingClientRect()), owner: owner, op: op });
    });
    registry.forEach(function (el) {
      if (el.dataset.transient) return;
      var k = el.dataset.kind;
      if (k !== 'box' && k !== 'code' && k !== 'note' && k !== 'icon' && k !== 'token') return;
      var op = effectiveOpacity(el);
      if (op < 0.15) return;
      out.boxes.push({ el: el, label: String(el.__label).slice(0, 40), r: toVB(shapeRect(el)), op: op });
    });
    arrows.forEach(function (a) {
      if (effectiveOpacity(a.__path) < 0.15) return;
      out.arrows.push(a);
    });
    return out;
  }

  function shapeRect(el) { return (el.firstChild && el.dataset.kind !== 'icon' ? el.firstChild : el).getBoundingClientRect(); }

  function inter(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var hh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 2 && hh > 2 ? { w: w, h: hh } : null;
  }
  function same(a, b) { return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1; }
  function q(s) { return '"' + s + '"'; }

  /** Checks layout at time t. Elements still moving (or fading) are ignored. */
  function inspectAt(time, isFinal) {
    var issues = [];
    tl.seek(time, false);
    var A = snapshot();
    tl.seek(Math.min(tl.duration(), time + 0.15), false);
    var B = snapshot();
    function stable(list, bList, item) {
      for (var i = 0; i < bList.length; i++) if (bList[i].el === item.el) return same(bList[i].r, item.r) && Math.abs(bList[i].op - item.op) < 0.05;
      return false;
    }
    var texts = A.texts.filter(function (t) { return stable(A.texts, B.texts, t); });
    var boxes = A.boxes.filter(function (b) { return stable(A.boxes, B.boxes, b); });
    var tag = ' (at ' + time.toFixed(1) + 's)';

    texts.forEach(function (t) {
      var r = t.r;
      if (r.x < -2 || r.y < -2 || r.x + r.w > W + 2 || r.y + r.h > H + 2) issues.push('Text ' + q(t.label) + ' goes outside the 960x540 canvas' + tag);
      if (t.el.dataset.short) issues.push('Arrow label ' + q(t.label) + ' hides most of its ' + t.el.dataset.short + 'px arrow: leave more space between the shapes (arrow ≥ label width + 48px) or shorten the label');
      if (t.el.dataset.overflow) issues.push('Text ' + q(t.label) + ' does not fit its ' + t.el.dataset.overflow + 'px-wide box: widen the box or shorten the text');
    });
    boxes.forEach(function (b) {
      var r = b.r;
      if (r.x < -2 || r.y < -2 || r.x + r.w > W + 2 || r.y + r.h > H + 2) issues.push('Shape ' + q(b.label) + ' goes outside the 960x540 canvas' + tag);
    });
    for (var i = 0; i < texts.length; i++) for (var j = i + 1; j < texts.length; j++) {
      if (inter(texts[i].r, texts[j].r)) issues.push('Text ' + q(texts[i].label) + ' overlaps text ' + q(texts[j].label) + tag);
    }
    for (i = 0; i < boxes.length; i++) for (j = i + 1; j < boxes.length; j++) {
      if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
      if (inter(boxes[i].r, boxes[j].r)) issues.push('Shape ' + q(boxes[i].label) + ' overlaps shape ' + q(boxes[j].label) + tag);
    }
    texts.forEach(function (t) {
      boxes.forEach(function (b) {
        if (b.el.contains(t.el)) return;
        if (inter(t.r, b.r)) issues.push('Text ' + q(t.label) + ' overlaps shape ' + q(b.label) + tag);
      });
    });
    // arrows passing through unrelated shapes
    var m = root.getScreenCTM().inverse();
    var stableArrows = A.arrows.filter(function (a) { return B.arrows.indexOf(a) >= 0 && Math.abs(effectiveOpacity(a.__path) - 1) < 0.05; });
    function arrowName(a) { return (a.__from ? a.__from.__label : 'point') + ' → ' + (a.__to ? a.__to.__label : 'point'); }
    // arrows left pointing at shapes that have been hidden (only the final frame: mid-animation this is normal)
    if (isFinal) stableArrows.forEach(function (a) {
      [a.__from, a.__to].forEach(function (end) {
        if (end && effectiveOpacity(end) < 0.15) issues.push('Arrow ' + q(arrowName(a)) + ' is still visible but its shape ' + q(end.__label) + ' was hidden: hide the arrow too' + tag);
      });
    });
    // arrows crossing each other
    function poly(a) {
      var p = a.__path, len = p.getTotalLength(), ctm = p.getScreenCTM(), pts = [];
      for (var s = 0; s <= 16; s++) pts.push(p.getPointAtLength((len * s) / 16).matrixTransform(ctm).matrixTransform(m));
      return pts;
    }
    function segX(p1, p2, p3, p4) {
      var d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
      if (Math.abs(d) < 1e-9) return false;
      var u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
      var v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
      return u > 0.02 && u < 0.98 && v > 0.02 && v < 0.98;
    }
    var polys = stableArrows.map(poly);
    for (i = 0; i < stableArrows.length; i++) for (j = i + 1; j < stableArrows.length; j++) {
      var a1 = stableArrows[i], a2 = stableArrows[j];
      var ends1 = [a1.__from, a1.__to], ends2 = [a2.__from, a2.__to];
      if (ends1.some(function (e) { return e && ends2.indexOf(e) >= 0; })) continue; // share a shape: meeting is expected
      var crossed = false;
      for (var s1 = 0; s1 < 16 && !crossed; s1++) for (var s2 = 0; s2 < 16 && !crossed; s2++) {
        if (segX(polys[i][s1], polys[i][s1 + 1], polys[j][s2], polys[j][s2 + 1])) crossed = true;
      }
      if (crossed) issues.push('Arrows ' + q(arrowName(a1)) + ' and ' + q(arrowName(a2)) + ' cross each other: reorder or move shapes so arrows do not cross' + tag);
    }
    A.arrows.forEach(function (a) {
      var p = a.__path, len = p.getTotalLength(), ctm = p.getScreenCTM();
      var hit = {};
      for (var s = 1; s < 24; s++) {
        var pt = p.getPointAtLength((len * s) / 24).matrixTransform(ctm).matrixTransform(m);
        boxes.forEach(function (b) {
          if (b.el === a.__from || b.el === a.__to || hit[b.label]) return;
          var r = b.r;
          if (pt.x > r.x + 4 && pt.x < r.x + r.w - 4 && pt.y > r.y + 4 && pt.y < r.y + r.h - 4) {
            hit[b.label] = 1;
            var nm = (a.__from ? a.__from.__label : 'point') + ' → ' + (a.__to ? a.__to.__label : 'point');
            issues.push('Arrow ' + q(nm) + ' passes through shape ' + q(b.label) + '; route it around (fromSide/toSide/bend) or move things' + tag);
          }
        });
      }
    });
    return issues;
  }

  function inspect() {
    if (!tl) return { issues: ['No timeline'], warnings: [] };
    var d = tl.duration();
    var times = [0.3, 0.55, 0.8].map(function (f) { return d * f; }).concat([Math.max(0, d - 0.16)]);
    var seen = {}, issues = [];
    times.forEach(function (t, k) {
      inspectAt(t, k === times.length - 1).forEach(function (msg) {
        var key = msg.replace(/ \(at [\d.]+s\)$/, '');
        if (!seen[key]) { seen[key] = 1; issues.push(msg); }
      });
    });
    var warnings = [];
    tl.getChildren(true, true, false).forEach(function (tw) {
      if (tw.duration() > 0 && tw.duration() < 0.2 && tw.vars && tw.vars.opacity != null) warnings.push('Very fast opacity change (' + tw.duration() + 's) may look like a flash');
    });
    if (d > 20) warnings.push('Animation is long (' + d.toFixed(1) + 's)');
    tl.seek(d, false);
    return { issues: issues.slice(0, 15), warnings: warnings.slice(0, 5), duration: d };
  }

  // ---------------------------------------------------------------- player bridge
  var lastSent = -1;
  function post(msg) { if (window.parent !== window) window.parent.postMessage(msg, '*'); }

  function wireTimeline() {
    tl.eventCallback('onUpdate', function () {
      var p = tl.progress();
      if (Math.abs(p - lastSent) > 0.004 || p === 1 || p === 0) { lastSent = p; post({ type: 'progress', progress: p }); }
    });
    tl.eventCallback('onComplete', function () { post({ type: 'complete' }); });
  }

  function load(codeStr, themeName) {
    var res = run(codeStr, themeName);
    if (!res.ok) { post({ type: 'error', message: res.error }); return; }
    wireTimeline();
    tl.progress(0);
    post({ type: 'ready', duration: res.duration });
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var m = ev.data || {};
    try {
      if (m.type === 'load') load(String(m.code || ''), m.theme);
      else if (!tl) return;
      else if (m.type === 'play') { if (tl.progress() >= 1) tl.restart(); else tl.play(); }
      else if (m.type === 'pause') tl.pause();
      else if (m.type === 'restart') { tl.pause(); tl.progress(0); tl.play(); }
      else if (m.type === 'seek') { tl.pause(); tl.progress(Math.max(0, Math.min(1, +m.progress || 0))); }
      else if (m.type === 'theme') {
        var p = tl.progress(), playing = tl.isActive();
        var res = run(currentCode, m.theme);
        if (!res.ok) { post({ type: 'error', message: res.error }); return; }
        wireTimeline();
        tl.progress(p);
        if (playing) tl.play();
      }
    } catch (e) {
      post({ type: 'error', message: (e && e.message) || String(e) });
    }
  });

  window.addEventListener('error', function (e) { post({ type: 'error', message: e.message || 'Script error' }); });

  window.AnimLearn = { run: run, inspect: inspect, seek: function (p) { if (tl) tl.progress(p); }, h: h };
})();
