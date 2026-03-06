import type { DOMTreeNode, DistilledNode, SemanticFilterConfig } from './types';
import type { TaskProgress } from './scheduler.types';
import { schedule } from './scheduler';

const SEMANTIC_INTERACTIVE_TAGS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  'summary'
]);

/**
 * Calculate an InteractionRank score (0–10+) for a single node.
 *
 * Higher scores indicate elements that are more likely to be
 * meaningful interaction targets for AI agents.
 *
 * Scoring factors:
 * - Semantic interactive tags (`button`, `a`, `input`, etc.): +3
 * - ARIA roles (`button`, `menuitem`): +2
 * - `href` attribute: +3
 * - `name` attribute: +2
 * - `placeholder` attribute: +1
 * - Semantic container: +1
 * - Invisible elements: score reset to 0
 *
 * @param node - The `DOMTreeNode` to score
 * @returns A numeric rank (0 = invisible/irrelevant, 6+ = high-value target)
 */
export const calculateInteractionRank = (node: DOMTreeNode): number => {
  const tag = node.tag;
  const attrs = node.attributes ?? {};

  let rank = 0;

  if (SEMANTIC_INTERACTIVE_TAGS.has(tag)) {
    rank += 3;
  }

  if (attrs.role === 'button' || attrs.role === 'menuitem') {
    rank += 2;
  }

  if (attrs.href) {
    rank += 3;
  }

  if (attrs.name) {
    rank += 2;
  }

  if (attrs.placeholder) {
    rank += 1;
  }

  if (node.semantic?.isContainer) {
    rank += 1;
  }

  if (!node.visible) {
    rank = 0;
  }

  return rank;
};

/**
 * Filter a distilled tree to only the semantically important nodes.
 *
 * Traverses the tree and keeps nodes whose InteractionRank meets or
 * exceeds the configured threshold. Returns a flat list of `DistilledNode`
 * objects, ideal for feeding directly to an LLM.
 *
 * @param tree - The root `DOMTreeNode` to filter
 * @param config - Optional config (default `minRank: 2`)
 * @returns A flat array of high-value `DistilledNode` entries
 *
 * @example
 * ```ts
 * const important = filter(tree, { minRank: 3 });
 * // Returns only nodes with InteractionRank >= 3
 * ```
 */
export const filter = (
  tree: DOMTreeNode,
  config: SemanticFilterConfig = {}
): DistilledNode[] => {
  const { minRank = 2 } = config;

  const result: DistilledNode[] = [];

  const visit = (node: DOMTreeNode) => {
    const rank = calculateInteractionRank(node);
    if (rank >= minRank) {
      const distilled: DistilledNode = {
        id: node.id,
        text: node.text,
        selector: node.selector,
        rank,
        isContainer: node.semantic?.isContainer,
        containerType: node.semantic?.containerType,
        attributes: {
          testId: node.attributes?.testId,
          name: node.attributes?.name,
          placeholder: node.attributes?.placeholder,
          href: node.attributes?.href,
          role: node.attributes?.role,
          type: node.attributes?.type
        }
      };
      result.push(distilled);
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  visit(tree);

  return result;
};

/**
 * Asynchronously filter a tree using cooperative scheduling.
 *
 * Same as `filter()`, but offloaded via `requestIdleCallback` to
 * avoid blocking the main thread on large trees.
 *
 * @param tree - The root `DOMTreeNode` to filter
 * @param config - Optional filter config
 * @returns A promise resolving to a flat array of `DistilledNode` entries
 *
 * @example
 * ```ts
 * const nodes = await filterAsync(tree, { minRank: 2 });
 * ```
 */
export const filterAsync = async (
  tree: DOMTreeNode,
  config: SemanticFilterConfig = {}
): Promise<DistilledNode[]> => {
  return schedule(
    { priority: 'idle' },
    function* (): Generator<TaskProgress, DistilledNode[], void> {
      const result = filter(tree, config);
      yield { type: 'progress', processed: 1, total: 1 };
      return result;
    }
  );
};
