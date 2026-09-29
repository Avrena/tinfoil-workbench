import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramSpec, diagramSVG } from '../dist/core/visual-tools.js';

const rects = svg => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="180" height="55"/g)].map(m => ({ x: +m[1], y: +m[2] }));
const edges = svg => [...svg.matchAll(/<path d="M([\d.-]+) ([\d.-]+) C[^"]* ([\d.-]+) ([\d.-]+)" fill="none" stroke="#75b9ff"/g)].map(m => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }));
const labels = svg => [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(\w+)"[^>]*class="edge-label">([^<]*)</g)].map(m => ({ lx: +m[1], ly: +m[2], anchor: m[3], text: m[4] }));
const viewBox = svg => svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const inside = (p, r) => p.x > r.x + 0.5 && p.x < r.x + 179.5 && p.y > r.y + 0.5 && p.y < r.y + 54.5;

test('empty grid columns and rows are not drawn as blank space', () => {
  // As a real model placed them: the browser at column 0, the load balancer at column 5, the resolver two rows down.
  const spec = diagramSpec({ title: 'Path', nodes: [{ id: 'browser', label: 'Browser', column: 0, row: 1 }, { id: 'dns', label: 'DNS', column: 0, row: 3 }, { id: 'lb', label: 'Load balancer', column: 5, row: 1 }],
    edges: [{ from: 'browser', to: 'lb' }] });
  const svg = diagramSVG(spec, 'arrow', false);
  assert.deepEqual(rects(svg), [{ x: 40, y: 24 }, { x: 40, y: 154 }, { x: 270, y: 24 }]);
  assert.equal(viewBox(svg)[2], 600, 'two used columns, not six');
  assert.equal(viewBox(svg)[3], 24 + 130 + 55 + 24, 'two used rows, not four');
});

test('edges both ways between two nodes run side by side with their labels apart', () => {
  const spec = diagramSpec({ title: 'DNS', nodes: [{ id: 'browser', label: 'Browser', column: 0, row: 0 }, { id: 'dns', label: 'DNS', column: 0, row: 1 }, { id: 'lb', label: 'LB', column: 1, row: 0 }, { id: 'app', label: 'App', column: 2, row: 0 }],
    edges: [{ from: 'browser', to: 'dns', label: 'lookup' }, { from: 'dns', to: 'browser', label: 'address' }, { from: 'lb', to: 'app', label: 'forward' }, { from: 'app', to: 'lb', label: 'response' }] });
  const svg = diagramSVG(spec, 'arrow', false), [down, up, right, left] = edges(svg), [dl, ul, rl, ll] = labels(svg);
  assert.deepEqual([dl, ul, rl, ll].map(l => l.text), ['lookup', 'address', 'forward', 'response']);
  assert.notEqual(down.x1, up.x2, 'the two vertical edges do not coincide');
  assert.ok(Math.abs(dl.lx - ul.lx) >= 16 && dl.anchor !== ul.anchor, 'their labels sit on either side');
  assert.notEqual(right.y1, left.y1, 'the two horizontal edges do not coincide');
  // Same-row labels sit above and below the row, clear of both nodes, and are drawn after the nodes.
  const row = rects(svg).find(r => r.x === 270);
  const [above, below] = [rl, ll].sort((p, q) => p.ly - q.ly);
  assert.ok(above.ly < row.y && below.ly > row.y + 55, 'one label sits above the row and the other below');
  assert.ok(svg.lastIndexOf('<rect') < svg.indexOf('class="edge-label"'), 'labels are drawn over nodes and lines');
  assert.match(svg, /class="edge-label"/);
  assert.match(svg.match(/<text[^>]*class="edge-label"/)[0], /stroke="#1e1e1e"[^>]*paint-order="stroke"/, 'with a halo of the surface colour');
  // A single edge keeps the centre line.
  const one = edges(diagramSVG(diagramSpec({ title: 'x', nodes: [{ id: 'a', label: 'A', column: 0, row: 0 }, { id: 'b', label: 'B', column: 0, row: 1 }], edges: [{ from: 'a', to: 'b' }] }), 'arrow', false))[0];
  assert.equal(one.x1, 130);
});

const curves = svg => [...svg.matchAll(/<path d="M([\d.-]+) ([\d.-]+) C([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)" fill="none" stroke="#75b9ff"/g)].map(m => m.slice(1).map(Number))
  .map(([x0, y0, x1, y1, x2, y2, x3, y3]) => ({ start: { x: x0, y: y0 }, end: { x: x3, y: y3 }, mid: { x: (x0 + 3 * x1 + 3 * x2 + x3) / 8, y: (y0 + 3 * y1 + 3 * y2 + y3) / 8 } }));
// The renderer's own estimate of a label's extent: 6.2px a character, from 11px above the baseline to 3px below.
const labelBox = l => { const w = l.text.length * 6.2, x = l.anchor === 'middle' ? l.lx - w / 2 : l.anchor === 'end' ? l.lx - w : l.lx; return { x1: x - 2, y1: l.ly - 11, x2: x + w + 2, y2: l.ly + 3 }; };
const overlap = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

test('a pair of edges between different rows and columns is bent apart, each label beside its own curve', () => {
  // As a real model drew it: the browser one row below and one column left of the resolver, with edges both ways.
  const spec = diagramSpec({ title: 'DNS', nodes: [{ id: 'browser', label: 'Browser', column: 0, row: 1 }, { id: 'dns', label: 'DNS resolver', column: 1, row: 0 }],
    edges: [{ from: 'browser', to: 'dns', label: '1: resolve domain' }, { from: 'dns', to: 'browser', label: 'IP of the load balancer' }] });
  const svg = diagramSVG(spec, 'arrow', false), [up, down] = curves(svg), [upLabel, downLabel] = labels(svg), dns = rects(svg)[1];
  assert.ok(Math.abs(up.mid.y - down.mid.y) >= 20, `the curves' middles are ${Math.abs(up.mid.y - down.mid.y)}px apart`);
  const [upper, lower] = up.mid.y < down.mid.y ? [up, down] : [down, up];
  assert.equal(upper, up, 'the edge offset toward the upper node runs above the other');
  assert.ok(upLabel.ly < upper.mid.y && upLabel.anchor === 'middle', 'its label sits above its middle');
  assert.ok(downLabel.ly > dns.y + 55 && downLabel.lx > lower.start.x && downLabel.anchor === 'start', 'the other label sits beside its curve, below the resolver');
  assert.ok(!overlap(labelBox(upLabel), labelBox(downLabel)));
  // A pair in one column keeps its straight side-by-side layout.
  const straight = curves(diagramSVG(diagramSpec({ title: 'x', nodes: [{ id: 'a', label: 'A', column: 0, row: 0 }, { id: 'b', label: 'B', column: 0, row: 1 }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }), 'arrow', false));
  assert.deepEqual(straight.map(c => Math.round(c.mid.y)), [Math.round(straight[0].mid.y), Math.round(straight[0].mid.y)]);
});

test('labels never cover a node or one another', () => {
  // Long labels on consecutive edges of one row would overlap above it; the second moves up a line.
  const chain = diagramSpec({ title: 'Chain', nodes: ['a', 'b', 'c'].map((id, i) => ({ id, label: id.toUpperCase(), column: i, row: 0 })),
    edges: [{ from: 'a', to: 'b', label: 'a fairly long label that spills over' }, { from: 'b', to: 'c', label: 'another long label beside the first one' }] });
  const request = diagramSpec({ title: 'Request', nodes: [{ id: 'browser', label: 'Browser', column: 0, row: 1 }, { id: 'dns', label: 'DNS', column: 1, row: 0 }, { id: 'lb', label: 'Load balancer', column: 1, row: 1 },
    { id: 'app', label: 'App server', column: 2, row: 1 }, { id: 'cache', label: 'Cache', column: 2, row: 0 }, { id: 'db', label: 'Database', column: 2, row: 2 }],
    edges: [['browser', 'dns', '1: resolve domain'], ['dns', 'browser', 'IP of the load balancer'], ['browser', 'lb', '2: TCP + TLS, then HTTP request'], ['lb', 'browser', '7: response'],
      ['lb', 'app', '3: forward'], ['app', 'cache', '4: cache check'], ['app', 'db', '5: query on miss'], ['db', 'app', '6: rows']].map(([from, to, label]) => ({ from, to, label })) });
  for (const [spec, heading] of [[chain, true], [request, false], [request, true]]) {
    const svg = diagramSVG(spec, 'arrow', heading), boxes = labels(svg).map(labelBox), nodes = rects(svg).map(r => ({ x1: r.x, y1: r.y, x2: r.x + 180, y2: r.y + 55 }));
    assert.equal(boxes.length, spec.edges.length);
    boxes.forEach((b, i) => {
      assert.ok(!nodes.some(n => overlap(b, n)), `${spec.title}: label ${i} covers a node`);
      assert.ok(!boxes.slice(0, i).some(o => overlap(b, o)), `${spec.title}: label ${i} covers an earlier label`);
    });
  }
  const [first, second] = labels(diagramSVG(chain, 'arrow', true));
  assert.equal(second.ly, first.ly - 14, 'the second chain label moved up a line');
});

test('every arrow ends on the edge of its target, never hidden under a node', () => {
  // Down, up, right, left and diagonal edges, including a pair in both directions.
  const nodes = [{ id: 'a', label: 'A', column: 0, row: 0 }, { id: 'b', label: 'B', column: 1, row: 0 }, { id: 'c', label: 'C', column: 0, row: 1 }, { id: 'd', label: 'D', column: 1, row: 1 }];
  const links = [['a', 'b'], ['b', 'a'], ['a', 'c'], ['c', 'a'], ['d', 'b'], ['d', 'c'], ['a', 'd'], ['c', 'b']];
  const svg = diagramSVG(diagramSpec({ title: 'x', nodes, edges: links.map(([from, to]) => ({ from, to })) }), 'arrow', false), boxes = rects(svg);
  const paths = edges(svg);
  assert.equal(paths.length, links.length);
  for (const p of paths) {
    for (const r of boxes) {
      assert.ok(!inside({ x: p.x2, y: p.y2 }, r), `arrow end ${p.x2},${p.y2} is inside a node`);
      assert.ok(!inside({ x: p.x1, y: p.y1 }, r), `arrow start ${p.x1},${p.y1} is inside a node`);
    }
  }
  assert.ok(!/NaN|Infinity/.test(svg));
});
