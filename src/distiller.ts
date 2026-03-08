import type {
  CompressedNode,
  CompressedTree,
  DOMTreeNode,
  TreeDistillerConfig,
  TreeMetrics
} from './types';
import type { TaskProgress } from './scheduler.types';
import { schedule } from './scheduler';

const DEFAULT_MAX_DEPTH = 15;
const DEFAULT_MAX_NODES = 500;

type SelectorContext = {
  prioritySelectors: string[];
};

const createIdGenerator = () => {
  let counter = 0;
  const prefix = Date.now().toString(36);
  return () => {
    counter += 1;
    return `dom-node-${prefix}-${counter}`;
  };
};

const getDirectText = (element: Element): string | undefined => {
  let result = '';
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? '';
    }
  }
  const trimmed = result.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Fallback text extraction: uses `textContent` to capture text from
 * nested children (e.g. `<a><svg/><span>Issues</span></a>`).
 * Capped at 80 chars to avoid pulling entire paragraph bodies.
 */
const getVisibleText = (element: Element): string | undefined => {
  const raw = element.textContent?.trim();
  if (!raw || raw.length === 0) return undefined;
  // Collapse whitespace runs and cap length
  const clean = raw.replace(/\s+/g, ' ');
  return clean.length > 80 ? clean.slice(0, 80) + '…' : clean;
};

const buildSelector = (element: Element, context: SelectorContext): string => {
  const testId = element.getAttribute('data-testid') ?? element.getAttribute('data-aid');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  const id = element.getAttribute('id');
  if (id) {
    return `#${CSS.escape(id)}`;
  }

  const name = element.getAttribute('name');
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  // Fallback: structural selector using nth-of-type
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    let selector = tag;

    const currentId = current.getAttribute('id');
    if (currentId) {
      selector = `${tag}#${CSS.escape(currentId)}`;
      parts.unshift(selector);
      break;
    }

    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(selector);
      break;
    }

    const siblings = Array.from(parent.children).filter((n: Element) => n.tagName === current!.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      selector = `${selector}:nth-of-type(${index})`;
    }

    parts.unshift(selector);
    current = parent;
  }

  return parts.join(' > ');
};

/**
 * Compute a selector stability confidence score (0–1).
 *
 * Higher scores indicate more stable selectors that are unlikely to break
 * across DOM mutations or page reloads.
 */
const selectorConfidence = (element: Element): number => {
  if (element.getAttribute('data-testid') ?? element.getAttribute('data-aid')) {
    return 1.0;
  }
  if (element.getAttribute('id')) {
    return 0.9;
  }
  if (element.getAttribute('name')) {
    return 0.8;
  }
  if (element.getAttribute('aria-label')) {
    return 0.7;
  }
  // Structural fallback (nth-of-type) is fragile
  return 0.3;
};

const isElementVisible = (element: Element, includeInvisible: boolean): boolean => {
  if (includeInvisible) return true;

  // ARIA hidden elements are intended to be skipped by assistive tech and usually AI agents
  if (element.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  return true;
};

const detectActionType = (element: Element): DOMTreeNode['actionType'] => {
  const tag = element.tagName.toLowerCase();
  const type = element.getAttribute('type')?.toLowerCase();
  const role = element.getAttribute('role')?.toLowerCase();

  if (tag === 'button' || role === 'button') {
    if (type === 'submit') return 'submit';
    if (element.getAttribute('aria-pressed') != null) return 'toggle';
    return 'click';
  }

  if (tag === 'input') {
    if (type === 'submit' || type === 'button') return 'submit';
    if (type === 'checkbox' || type === 'radio') return 'click';
    return 'input';
  }

  if (tag === 'select' || tag === 'textarea' || role === 'textbox' || role === 'searchbox') {
    return 'input';
  }

  if (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') {
    return 'input';
  }

  if (tag === 'a' && element.hasAttribute('href')) {
    return 'navigate';
  }

  return undefined;
};

const isInteractive = (element: Element): boolean => {
  if (detectActionType(element) != null) return true;
  if (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') return true;
  return false;
};

const analyzeSemantic = (element: Element): DOMTreeNode['semantic'] => {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role') ?? '';
  const className = element.getAttribute('class') ?? '';

  const semantic: DOMTreeNode['semantic'] = {
    importance: 0
  };

  if (tag === 'form' || role === 'form') {
    semantic.isForm = true;
    semantic.importance += 2;
  }

  if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') {
    semantic.isOverlay = true;
    semantic.importance += 5;
  }

  if (tag === 'nav' || role === 'navigation') {
    semantic.isNavigation = true;
    semantic.importance += 2;
  }

  if (
    tag === 'article' ||
    tag === 'section' ||
    role === 'region' ||
    /\b(card|panel|widget)\b/i.test(className)
  ) {
    semantic.isContainer = true;
    semantic.containerType = 'section';
    semantic.importance += 1;
  }

  return semantic;
};

const getRect = (element: Element): DOMTreeNode['rect'] => {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
};

/**
 * Synchronously distill a DOM subtree into a structured, LLM-friendly tree.
 *
 * Performs a single-pass traversal building nodes with smart selectors,
 * semantic analysis, visibility checks, and action type detection.
 *
 * @param root - The root element to distill (defaults to `document.body`)
 * @param config - Optional configuration for depth limits, node caps, etc.
 * @returns A complete `DOMTreeNode` tree
 *
 * @example
 * ```ts
 * const tree = distill(document.body, { maxDepth: 10, maxNodes: 200 });
 * ```
 */
export const distill = (
  root: Element = document.body,
  config: TreeDistillerConfig = {}
): DOMTreeNode => {
  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    maxNodes = DEFAULT_MAX_NODES,
    includeInvisible = false,
    prioritySelectors = [],
    semanticAnalysis = true
  } = config;

  const idGenerator = createIdGenerator();
  let nodeCount = 0;

  const context: SelectorContext = {
    prioritySelectors
  };

  const buildNode = (element: Element, depth: number, parent?: DOMTreeNode): DOMTreeNode | null => {
    if (depth > maxDepth) return null;
    if (nodeCount >= maxNodes) return null;

    const visible = isElementVisible(element, includeInvisible);
    const rect = getRect(element);
    const id = idGenerator();
    const text =
      element.getAttribute('aria-label') ??
      element.getAttribute('aria-description') ??
      getDirectText(element) ??
      getVisibleText(element);

    const interactive = isInteractive(element);
    const actionType = detectActionType(element);

    const attributes: DOMTreeNode['attributes'] = {
      testId: element.getAttribute('data-testid') ?? undefined,
      id: element.getAttribute('id') ?? undefined,
      name: element.getAttribute('name') ?? undefined,
      role: element.getAttribute('role') ?? undefined,
      ariaLabel: element.getAttribute('aria-label') ?? undefined,
      ariaDescription: element.getAttribute('aria-description') ?? undefined,
      ariaExpanded: element.getAttribute('aria-expanded') ?? undefined,
      ariaChecked: element.getAttribute('aria-checked') ?? undefined,
      ariaCurrent: element.getAttribute('aria-current') ?? undefined,
      placeholder: element.getAttribute('placeholder') ?? undefined,
      value: (element as HTMLInputElement).value || undefined,
      type: element.getAttribute('type') ?? undefined,
      disabled: element.hasAttribute('disabled') || undefined,
      href: element.getAttribute('href') ?? undefined,
      contenteditable: element.getAttribute('contenteditable') ?? undefined
    };

    const selector = buildSelector(element, context);

    const node: DOMTreeNode = {
      id,
      tag: element.tagName.toLowerCase(),
      text,
      interactive,
      actionType,
      confidence: selectorConfidence(element),
      selector,
      children: [],
      parent,
      depth,
      visible,
      rect,
      attributes,
      element: new WeakRef(element)
    };

    if (semanticAnalysis) {
      node.semantic = analyzeSemantic(element);
    }

    nodeCount += 1;

    // Optimization: Skip recursion for hidden subtrees to save node limit budget
    const computedStyle = getComputedStyle(element);
    if ((computedStyle.display === 'none' || element.getAttribute('aria-hidden') === 'true') && !includeInvisible) {
      return node;
    }

    for (const child of Array.from(element.children)) {
      const childNode = buildNode(child, depth + 1, node);
      if (childNode) {
        node.children.push(childNode);
      }
      if (nodeCount >= maxNodes) {
        break;
      }
    }

    return node;
  };

  const tree = buildNode(root, 0);
  if (!tree) {
    throw new Error('Failed to distill DOM tree');
  }
  return tree;
};

/** Number of nodes to process per scheduler chunk before yielding. */
const ASYNC_CHUNK_SIZE = 50;

/**
 * Asynchronously distill a DOM subtree using cooperative scheduling.
 *
 * Performs a genuinely chunked traversal: the DFS walk yields control
 * back to the main thread every {@link ASYNC_CHUNK_SIZE} nodes via
 * `requestIdleCallback` (5ms time budget). This prevents jank even
 * on 10k+ node DOMs.
 *
 * @param root - The root element to distill (defaults to `document.body`)
 * @param config - Optional configuration for depth limits, node caps, etc.
 * @returns A promise resolving to a `DOMTreeNode` tree
 *
 * @example
 * ```ts
 * const tree = await distillAsync(document.body, { maxNodes: 1000 });
 * ```
 */
export const distillAsync = async (
  root: Element = document.body,
  config: TreeDistillerConfig = {}
): Promise<DOMTreeNode> => {
  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    maxNodes = DEFAULT_MAX_NODES,
    includeInvisible = false,
    prioritySelectors = [],
    semanticAnalysis = true
  } = config;

  return schedule(
    { priority: config.async === false ? 'immediate' : 'idle' },
    function* (): Generator<TaskProgress, DOMTreeNode, void> {
      const idGenerator = createIdGenerator();
      let nodeCount = 0;

      const context: SelectorContext = { prioritySelectors };

      // Stack-based DFS: each entry is [element, depth, parentNode]
      type StackEntry = { element: Element; depth: number; parent?: DOMTreeNode };
      const rootNode = buildNodeShallow(root, 0, undefined, idGenerator, context, includeInvisible, semanticAnalysis);
      if (!rootNode) {
        throw new Error('Failed to distill DOM tree');
      }
      nodeCount += 1;

      // Seed the stack with root's children (reverse order for correct DFS)
      const stack: StackEntry[] = [];
      const rootChildren = Array.from(root.children);
      for (let i = rootChildren.length - 1; i >= 0; i--) {
        stack.push({ element: rootChildren[i]!, depth: 1, parent: rootNode });
      }

      while (stack.length > 0 && nodeCount < maxNodes) {
        // Process a chunk of nodes, then yield
        const chunkEnd = Math.min(ASYNC_CHUNK_SIZE, stack.length);
        for (let c = 0; c < chunkEnd && stack.length > 0 && nodeCount < maxNodes; c++) {
          const { element, depth, parent } = stack.pop()!;
          if (depth > maxDepth) continue;

          const node = buildNodeShallow(element, depth, parent, idGenerator, context, includeInvisible, semanticAnalysis);
          if (!node) continue;

          nodeCount += 1;
          if (parent) {
            parent.children.push(node);
          }

          // Optimization: Skip pushing children to stack if the subtree is hidden
          const style = getComputedStyle(element);
          if ((style.display === 'none' || element.getAttribute('aria-hidden') === 'true') && !includeInvisible) {
            continue;
          }

          // Push children in reverse for correct traversal order
          const kids = Array.from(element.children);
          for (let i = kids.length - 1; i >= 0; i--) {
            stack.push({ element: kids[i]!, depth: depth + 1, parent: node });
          }
        }

        yield { type: 'progress', processed: nodeCount, total: maxNodes };
      }

      return rootNode;
    }
  );
};

/**
 * Build a single DOMTreeNode without recursing into children.
 * Used by `distillAsync` for chunked traversal.
 */
const buildNodeShallow = (
  element: Element,
  depth: number,
  parent: DOMTreeNode | undefined,
  idGenerator: () => string,
  context: SelectorContext,
  includeInvisible: boolean,
  semanticAnalysis: boolean
): DOMTreeNode | null => {
  const visible = isElementVisible(element, includeInvisible);
  const rect = getRect(element);
  const id = idGenerator();
  const text =
    element.getAttribute('aria-label') ??
    element.getAttribute('aria-description') ??
    getDirectText(element) ??
    getVisibleText(element);

  const interactive = isInteractive(element);
  const actionType = detectActionType(element);

  const attributes: DOMTreeNode['attributes'] = {
    testId: element.getAttribute('data-testid') ?? undefined,
    id: element.getAttribute('id') ?? undefined,
    name: element.getAttribute('name') ?? undefined,
    role: element.getAttribute('role') ?? undefined,
    ariaLabel: element.getAttribute('aria-label') ?? undefined,
    ariaDescription: element.getAttribute('aria-description') ?? undefined,
    ariaExpanded: element.getAttribute('aria-expanded') ?? undefined,
    ariaChecked: element.getAttribute('aria-checked') ?? undefined,
    ariaCurrent: element.getAttribute('aria-current') ?? undefined,
    placeholder: element.getAttribute('placeholder') ?? undefined,
    value: (element as HTMLInputElement).value || undefined,
    type: element.getAttribute('type') ?? undefined,
    disabled: element.hasAttribute('disabled') || undefined,
    href: element.getAttribute('href') ?? undefined,
    contenteditable: element.getAttribute('contenteditable') ?? undefined
  };

  const selector = buildSelector(element, context);

  const node: DOMTreeNode = {
    id,
    tag: element.tagName.toLowerCase(),
    text,
    interactive,
    actionType,
    confidence: selectorConfidence(element),
    selector,
    children: [],
    parent,
    depth,
    visible,
    rect,
    attributes,
    element: new WeakRef(element)
  };

  if (semanticAnalysis) {
    node.semantic = analyzeSemantic(element);
  }

  return node;
};

/**
 * Compute aggregate metrics for a distilled tree.
 *
 * @param tree - The root `DOMTreeNode` to analyze
 * @returns Metrics including total nodes, interactive count, max depth, etc.
 */
export const metrics = (tree: DOMTreeNode): TreeMetrics => {
  let totalNodes = 0;
  let interactiveNodes = 0;
  let maxDepth = 0;
  let formCount = 0;
  let navigationCount = 0;

  const traverse = (node: DOMTreeNode) => {
    totalNodes += 1;
    if (node.interactive) interactiveNodes += 1;
    if (node.depth > maxDepth) maxDepth = node.depth;

    if (node.semantic?.isForm) formCount += 1;
    if (node.semantic?.isNavigation) navigationCount += 1;

    for (const child of node.children) {
      traverse(child);
    }
  };

  traverse(tree);

  let nonLeafNodes = 0;
  const countNonLeaves = (node: DOMTreeNode) => {
    if (node.children.length > 0) nonLeafNodes += 1;
    for (const child of node.children) countNonLeaves(child);
  };
  countNonLeaves(tree);
  const avgBranchingFactor = nonLeafNodes > 0 ? (totalNodes - 1) / nonLeafNodes : 0;

  return {
    totalNodes,
    interactiveNodes,
    maxDepth,
    avgBranchingFactor,
    formCount,
    navigationCount
  };
};

const compressNode = (node: DOMTreeNode): CompressedNode => {
  return {
    id: node.id,
    tag: node.tag,
    depth: node.depth,
    text: node.text,
    interactive: node.interactive,
    selector: node.selector,
    attributes: node.attributes,
    semantic: node.semantic,
    children: node.children.map((child) => compressNode(child))
  };
};

/**
 * Compress a `DOMTreeNode` tree to a minimal `CompressedTree` for LLM consumption.
 *
 * Strips runtime-only fields (parent refs, WeakRef, rect, confidence)
 * to produce a JSON-serializable structure optimized for token efficiency.
 *
 * @param tree - The tree to compress
 * @returns A `CompressedTree` suitable for `JSON.stringify()`
 */
export const compress = (tree: DOMTreeNode): CompressedTree => {
  return compressNode(tree);
};

const decompressNode = (
  node: CompressedNode,
  parent: DOMTreeNode | undefined
): DOMTreeNode => {
  const rect = { top: 0, left: 0, width: 0, height: 0 };

  const restored: DOMTreeNode = {
    id: node.id,
    tag: node.tag,
    text: node.text,
    interactive: node.interactive,
    actionType: undefined,
    confidence: 0, // Cannot reconstruct selector stability without original DOM
    selector: node.selector,
    children: [],
    parent,
    depth: node.depth,
    visible: true,
    rect,
    semantic: node.semantic,
    attributes: node.attributes
  };

  restored.children = node.children.map((child) => decompressNode(child, restored));
  return restored;
};

/**
 * Reconstruct a `DOMTreeNode` tree from compressed data.
 *
 * Re-establishes parent references and default values for fields
 * that were stripped during compression.
 *
 * @remarks
 * The `confidence` field is set to `0` on decompressed nodes because
 * the selector stability score cannot be recomputed without access to
 * the original DOM element. Use the `selector` field directly if you
 * need to act on the decompressed tree.
 *
 * @param tree - The compressed tree data
 * @returns A fully-linked `DOMTreeNode` tree
 */
export const decompress = (tree: CompressedTree): DOMTreeNode => {
  return decompressNode(tree, undefined);
};


