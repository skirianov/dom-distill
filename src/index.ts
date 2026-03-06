// ── Types ────────────────────────────────────────────────────────────
export type {
    DOMTreeNode,
    TreeDistillerConfig,
    TreeMetrics,
    CompressedNode,
    CompressedTree,
    DistilledNode,
    SemanticFilterConfig,
    NodeDelta,
    Rect,
    ActionType
} from './types';

export type { TaskConfig, TaskProgress } from './scheduler.types';

// ── Core: Distillation ───────────────────────────────────────────────
/** Synchronous single-pass DOM → tree distillation */
export { distill } from './distiller';

/** Async distillation via cooperative scheduling (`requestIdleCallback`) */
export { distillAsync } from './distiller';

/** Compute tree-level metrics (node count, depth, forms, nav, etc.) */
export { metrics } from './distiller';

// ── Core: Filtering ──────────────────────────────────────────────────
/** Filter tree nodes by InteractionRank score */
export { filter } from './filter';

/** Async filtering via cooperative scheduling */
export { filterAsync } from './filter';

/** Calculate an InteractionRank score (0–10+) for a single node */
export { calculateInteractionRank } from './filter';

// ── Compression ──────────────────────────────────────────────────────
/** Compress a tree for LLM consumption (strips runtime fields) */
export { compress } from './distiller';

/** Reconstruct a tree from compressed data */
export { decompress } from './distiller';

// ── Diffing ──────────────────────────────────────────────────────────
/** Fingerprint a single node for diffing */
export { fingerprintNode } from './fingerprint';

/** Fingerprint an entire node array */
export { fingerprintTree } from './fingerprint';

/** Three-way diff: changed / appeared / disappeared */
export { diff } from './fingerprint';

// ── Scheduling ───────────────────────────────────────────────────────
/** Low-level cooperative task scheduler */
export { schedule } from './scheduler';

// ── React Integration (optional, tree-shakeable) ─────────────────────
/** Enhance a DOM tree with React Fiber component context */
export { enhanceTreeWithFiber } from './fiber';

/** Find React components by name in an enhanced tree */
export { findReactComponents } from './fiber';

/** Get the component hierarchy path from a node */
export { getComponentHierarchy } from './fiber';

/** Analyze React component patterns (forms, modals, etc.) */
export { analyzeReactPatterns } from './fiber';

export type { EnhancedDOMTreeNode } from './fiber';
