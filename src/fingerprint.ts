import type { DistilledNode, NodeDelta } from './types';

/**
 * Generate a stable fingerprint string for a single distilled node.
 *
 * The fingerprint encodes the node's identity, text, rank, selector,
 * and serialized attributes. Two nodes with identical content will
 * produce identical fingerprints.
 *
 * @param node - The `DistilledNode` to fingerprint
 * @returns A deterministic string hash
 */
export function fingerprintNode(node: DistilledNode): string {
  const attrsHash = node.attributes ? JSON.stringify(node.attributes) : '';
  return `${node.id}|${node.text || ''}|${node.rank}|${node.selector}|${attrsHash}`;
}

/**
 * Fingerprint an entire array of distilled nodes.
 *
 * @param nodes - The nodes to fingerprint
 * @returns A `Map` from node ID to its fingerprint string
 */
export function fingerprintTree(nodes: DistilledNode[]): Map<string, string> {
  const fingerprints = new Map<string, string>();

  for (const node of nodes) {
    fingerprints.set(node.id, fingerprintNode(node));
  }

  return fingerprints;
}

/**
 * Compute a three-way diff between two distilled node arrays.
 *
 * Returns nodes that changed, appeared (new), or disappeared (removed)
 * between the two snapshots. This enables incremental LLM updates
 * instead of re-sending the entire tree.
 *
 * @param prev - The previous snapshot of distilled nodes
 * @param next - The current snapshot of distilled nodes
 * @returns A `NodeDelta` with `changed`, `appeared`, and `disappeared` arrays
 *
 * @example
 * ```ts
 * const delta = diff(previousNodes, currentNodes);
 * if (delta.changed.length > 0) {
 *   sendIncrementalUpdate(delta);
 * }
 * ```
 */
export function diff(prev: DistilledNode[], next: DistilledNode[]): NodeDelta {
  const prevMap = fingerprintTree(prev);
  const nextMap = fingerprintTree(next);

  const changed: DistilledNode[] = [];
  const appeared: DistilledNode[] = [];
  const disappeared: string[] = [];

  for (const node of next) {
    const prevFingerprint = prevMap.get(node.id);
    const nextFingerprint = fingerprintNode(node);

    if (!prevFingerprint) {
      appeared.push(node);
    } else if (prevFingerprint !== nextFingerprint) {
      changed.push(node);
    }
  }

  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) {
      disappeared.push(id);
    }
  }

  return { changed, appeared, disappeared };
}
