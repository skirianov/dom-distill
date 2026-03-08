import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { distill } from '../src/distiller';
import { filter, filterAsync, calculateInteractionRank } from '../src/filter';
import type { DOMTreeNode } from '../src/types';

describe('filter', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('keeps interactive elements and drops noise', () => {
    container.innerHTML = '<div>Non-interactive</div><button>Interactive</button>';
    const tree = distill(container);
    const distilled = filter(tree, { minRank: 2 });

    const hasButton = distilled.some((n) => n.selector.includes('button'));
    const hasDiv = distilled.some((n) => n.selector === 'div');

    expect(hasButton).toBe(true);
    // The div's text is not enough to pass minRank 2 (interactive = 0)
    expect(hasDiv).toBe(false);
  });

  it('calculateInteractionRank correctly scores nodes', () => {
    const btnNode: DOMTreeNode = {
      tag: 'button', visible: true, interactive: true, id: '1', selector: 'b', depth: 0, children: [], confidence: 1, rect: { top: 0, left: 0, width: 10, height: 10 }
    };

    // Button is semantic interactive (+3)
    expect(calculateInteractionRank(btnNode)).toBe(3);

    const hrefNode: DOMTreeNode = {
      tag: 'a', visible: true, interactive: true, attributes: { href: '/link' }, id: '2', selector: 'a', depth: 0, children: [], confidence: 1, rect: { top: 0, left: 0, width: 10, height: 10 }
    };
    // a (+3) + href (+3) 
    expect(calculateInteractionRank(hrefNode)).toBe(6);

    const hiddenNode: DOMTreeNode = {
      ...btnNode, visible: false
    };
    // Invisible resets rank to 0
    expect(calculateInteractionRank(hiddenNode)).toBe(0);
  });

  it('filterAsync returns same results as sync filter', async () => {
    container.innerHTML = '<a href="/link">Link</a><div>Noise</div><button>Btn</button>';
    const tree = distill(container);

    const syncResult = filter(tree, { minRank: 2 });
    const asyncResult = await filterAsync(tree, { minRank: 2 });

    expect(asyncResult.length).toBe(syncResult.length);
    expect(asyncResult.map(n => n.id)).toEqual(syncResult.map(n => n.id));
  });

  it('returns empty array for tree with no qualifying nodes', () => {
    container.innerHTML = '<div><div><div>Just text</div></div></div>';
    const tree = distill(container);
    const result = filter(tree, { minRank: 5 });

    expect(result).toHaveLength(0);
  });
});
