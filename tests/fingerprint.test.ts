import { describe, it, expect } from 'vitest';
import { fingerprintNode, fingerprintTree, diff } from '../src/fingerprint';
import type { DistilledNode } from '../src/types';

describe('fingerprint', () => {
  it('generates stable fingerprints for nodes', () => {
    const node: DistilledNode = {
      id: 'node-1',
      text: 'Click me',
      selector: 'button[data-testid="btn"]',
      rank: 5,
      attributes: { testId: 'btn' }
    };

    const fp1 = fingerprintNode(node);
    const fp2 = fingerprintNode({ ...node });

    expect(fp1).toBe(fp2);
    expect(fp1).toContain('node-1');
    expect(fp1).toContain('Click me');
  });

  it('computes basic deltas between node sets', () => {
    const prev: DistilledNode[] = [
      { id: 'a', text: 'A', selector: 'button#a', rank: 3 },
      { id: 'b', text: 'B', selector: 'button#b', rank: 3 }
    ];
    const next: DistilledNode[] = [
      { id: 'b', text: 'B-updated', selector: 'button#b', rank: 3 },
      { id: 'c', text: 'C', selector: 'button#c', rank: 3 }
    ];

    const delta = diff(prev, next);

    expect(delta.appeared).toHaveLength(1);
    expect(delta.appeared[0]?.id).toBe('c');

    expect(delta.disappeared).toContain('a');

    expect(delta.changed).toHaveLength(1);
    expect(delta.changed[0]?.id).toBe('b');
  });

  it('fingerprintTree maps nodes by ID', () => {
    const nodes: DistilledNode[] = [
      { id: 'a', text: 'A', selector: 'a', rank: 1 }
    ];
    const map = fingerprintTree(nodes);
    expect(map.has('a')).toBe(true);
    expect(map.get('a')).toBe(fingerprintNode(nodes[0]!));
  });

  it('diff returns empty delta when arrays are identical', () => {
    const nodes: DistilledNode[] = [
      { id: 'a', text: 'A', selector: 'a', rank: 3 },
      { id: 'b', text: 'B', selector: 'b', rank: 3 }
    ];
    const delta = diff(nodes, nodes);

    expect(delta.changed).toHaveLength(0);
    expect(delta.appeared).toHaveLength(0);
    expect(delta.disappeared).toHaveLength(0);
  });

  it('diff reports all nodes as appeared when prev is empty', () => {
    const next: DistilledNode[] = [
      { id: 'a', text: 'A', selector: 'a', rank: 3 },
      { id: 'b', text: 'B', selector: 'b', rank: 3 }
    ];
    const delta = diff([], next);

    expect(delta.appeared).toHaveLength(2);
    expect(delta.changed).toHaveLength(0);
    expect(delta.disappeared).toHaveLength(0);
  });

  it('diff reports all nodes as disappeared when next is empty', () => {
    const prev: DistilledNode[] = [
      { id: 'a', text: 'A', selector: 'a', rank: 3 },
      { id: 'b', text: 'B', selector: 'b', rank: 3 }
    ];
    const delta = diff(prev, []);

    expect(delta.disappeared).toHaveLength(2);
    expect(delta.changed).toHaveLength(0);
    expect(delta.appeared).toHaveLength(0);
  });
});
