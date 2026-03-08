import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { distill, distillAsync, metrics, compress, decompress } from '../src/distiller';

describe('distill', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('returns valid DOMTreeNode with required fields', () => {
    container.innerHTML = '<button>Click me</button>';
    const tree = distill(container);

    expect(tree).toHaveProperty('id');
    expect(tree).toHaveProperty('tag', 'div');
    expect(tree.children[0]?.tag).toBe('button');
    expect(tree.children[0]?.text).toBe('Click me');
    expect(tree.children[0]).toHaveProperty('depth', 1);
    expect(tree.children[0]).toHaveProperty('visible', true);
  });

  it('handles maxDepth', () => {
    container.innerHTML = '<div><div><button>Deep</button></div></div>';
    const tree = distill(container, { maxDepth: 1 });

    // Depth 0 is container (div), Depth 1 is child (div), Depth 2 (button) should be excluded
    expect(tree.children[0]?.children).toHaveLength(0);
  });

  it('handles includeInvisible', () => {
    container.innerHTML = '<div style="display:none;" data-display="none"><button>Hidden</button></div>';

    const treeHidden = distill(container, { includeInvisible: false });
    expect(treeHidden.children[0]?.visible).toBe(false);

    const treeVisible = distill(container, { includeInvisible: true });
    expect(treeVisible.children[0]?.visible).toBe(true);
  });

  it('handles deeply nested DOM with maxDepth correctly', () => {
    // Build 20 levels of nesting
    let html = '';
    for (let i = 0; i < 20; i++) html += '<div>';
    html += '<button>Deep</button>';
    for (let i = 0; i < 20; i++) html += '</div>';
    container.innerHTML = html;

    const tree = distill(container, { maxDepth: 5 });

    // Walk to the deepest node
    let deepest = tree;
    let maxReachedDepth = 0;
    const walk = (node: typeof tree) => {
      if (node.depth > maxReachedDepth) maxReachedDepth = node.depth;
      for (const child of node.children) walk(child);
    };
    walk(tree);

    // Depth 0 is container, maxDepth 5 means nothing beyond depth 5 is built
    expect(maxReachedDepth).toBeLessThanOrEqual(5);
  });

  it('respects maxNodes cap', () => {
    // Create 100 child elements
    container.innerHTML = Array.from({ length: 100 }, (_, i) => `<span>Item ${i}</span>`).join('');

    const tree = distill(container, { maxNodes: 20 });
    const m = metrics(tree);

    expect(m.totalNodes).toBeLessThanOrEqual(20);
  });

  it('handles empty container', () => {
    // Empty div, no children
    const tree = distill(container);
    expect(tree.tag).toBe('div');
    expect(tree.children).toHaveLength(0);
  });

  it('handles text-only content (no child elements)', () => {
    container.textContent = 'Just some text, no elements';
    const tree = distill(container);

    expect(tree.tag).toBe('div');
    expect(tree.text).toBe('Just some text, no elements');
    expect(tree.children).toHaveLength(0);
  });

  it('assigns confidence based on selector stability', () => {
    container.innerHTML = [
      '<button data-testid="btn">TestID</button>',
      '<button id="my-btn">ID</button>',
      '<input name="email" />',
      '<button aria-label="Submit">Aria</button>',
      '<span>Fallback</span>'
    ].join('');

    const tree = distill(container);
    const children = tree.children;

    expect(children[0]?.confidence).toBe(1.0);  // data-testid
    expect(children[1]?.confidence).toBe(0.9);  // id
    expect(children[2]?.confidence).toBe(0.8);  // name
    expect(children[3]?.confidence).toBe(0.7);  // aria-label
    expect(children[4]?.confidence).toBe(0.3);  // structural fallback
  });
});

describe('distillAsync', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('returns equivalent tree to sync distill', async () => {
    container.innerHTML = '<nav><a href="/">Home</a></nav><form><input name="q" /><button>Go</button></form>';

    const syncTree = distill(container);
    const asyncTree = await distillAsync(container);

    expect(asyncTree.tag).toBe(syncTree.tag);
    expect(asyncTree.children.length).toBe(syncTree.children.length);
    // Verify same structure: nav and form
    expect(asyncTree.children[0]?.tag).toBe('nav');
    expect(asyncTree.children[1]?.tag).toBe('form');
  });

  it('respects maxNodes in async mode', async () => {
    container.innerHTML = Array.from({ length: 100 }, (_, i) => `<span>Item ${i}</span>`).join('');

    const tree = await distillAsync(container, { maxNodes: 15 });
    const m = metrics(tree);

    expect(m.totalNodes).toBeLessThanOrEqual(15);
  });

  it('respects maxDepth in async mode', async () => {
    let html = '';
    for (let i = 0; i < 10; i++) html += '<div>';
    html += '<button>Deep</button>';
    for (let i = 0; i < 10; i++) html += '</div>';
    container.innerHTML = html;

    const tree = await distillAsync(container, { maxDepth: 3 });
    let maxDepth = 0;
    const walk = (node: typeof tree) => {
      if (node.depth > maxDepth) maxDepth = node.depth;
      for (const child of node.children) walk(child);
    };
    walk(tree);
    expect(maxDepth).toBeLessThanOrEqual(3);
  });
});

describe('metrics', () => {
  it('returns basic metrics for tree', () => {
    const container = document.createElement('div');
    container.innerHTML = '<form><button>Btn1</button><input type="text" /></form>';
    document.body.appendChild(container);

    const tree = distill(container);
    const m = metrics(tree);

    expect(m.totalNodes).toBe(4); // div, form, button, input
    expect(m.interactiveNodes).toBe(2); // button, input
    expect(m.formCount).toBe(1);

    document.body.removeChild(container);
  });

  it('computes correct avgBranchingFactor', () => {
    const container = document.createElement('div');
    // Tree: div > (span, span, div > (span, span))
    // Total nodes: 6 (container excluded — but actually container IS root)
    // Let's be explicit: root(div) has 3 children: span, span, div
    //   inner div has 2 children: span, span
    // Total = 6, non-leaf = 2 (root div, inner div)
    // avgBranching = (6-1) / 2 = 2.5
    container.innerHTML = '<span>A</span><span>B</span><div><span>C</span><span>D</span></div>';
    document.body.appendChild(container);

    const tree = distill(container);
    const m = metrics(tree);

    expect(m.totalNodes).toBe(6);
    expect(m.avgBranchingFactor).toBe(2.5);

    document.body.removeChild(container);
  });
});

describe('compression', () => {
  it('round-trips tree via compress/decompress', () => {
    const container = document.createElement('div');
    container.innerHTML = '<button data-testid="btn">Click</button>';
    document.body.appendChild(container);

    const original = distill(container);
    const compressed = compress(original);
    const restored = decompress(compressed);

    expect(restored.tag).toBe(original.tag);
    expect(restored.children.length).toBe(original.children.length);
    expect(restored.children[0]?.selector).toBe(original.children[0]?.selector);

    document.body.removeChild(container);
  });

  it('compressed output is JSON-serializable (no WeakRef, no parent)', () => {
    const container = document.createElement('div');
    container.innerHTML = '<nav><a href="/">Link</a></nav>';
    document.body.appendChild(container);

    const tree = distill(container);
    const compressed = compress(tree);

    // Should not throw — proves no WeakRef or circular parent refs
    const json = JSON.stringify(compressed);
    const parsed = JSON.parse(json);

    expect(parsed.tag).toBe('div');
    expect(parsed.children[0]?.tag).toBe('nav');

    document.body.removeChild(container);
  });
});
