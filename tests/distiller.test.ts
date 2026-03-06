import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { distill, metrics, compress, decompress } from '../src/distiller';

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
});
