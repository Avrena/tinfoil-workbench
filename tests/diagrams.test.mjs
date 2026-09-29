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
