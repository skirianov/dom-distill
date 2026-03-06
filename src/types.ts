export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type ActionType = 'click' | 'input' | 'select' | 'navigate' | 'submit' | 'toggle';

export interface DOMTreeNode {
  id: string;
  tag: string;
  text?: string;
  interactive: boolean;
  actionType?: ActionType;
  confidence: number;
  selector: string;
  children: DOMTreeNode[];
  parent?: DOMTreeNode;
  depth: number;
  visible: boolean;
  rect: Rect;
  semantic?: {
    intent?: string;
    importance: number;
    isForm?: boolean;
    isNavigation?: boolean;
    isDynamic?: boolean;
    isContainer?: boolean;
    containerType?: string;
    isOverlay?: boolean;
    portalOrigin?: string;
  };
  attributes?: {
    testId?: string;
    id?: string;
    name?: string;
    role?: string;
    ariaLabel?: string;
    ariaDescription?: string;
    ariaExpanded?: string;
    ariaChecked?: string;
    ariaCurrent?: string;
    placeholder?: string;
    value?: string;
    type?: string;
    disabled?: boolean;
    href?: string;
  };
  fingerprint?: string;
  element?: WeakRef<Element>;
}

export interface TreeMetrics {
  totalNodes: number;
  interactiveNodes: number;
  maxDepth: number;
  avgBranchingFactor: number;
  formCount: number;
  navigationCount: number;
}

export interface CompressedNode {
  id: string;
  tag: string;
  depth: number;
  text?: string;
  interactive: boolean;
  selector: string;
  attributes?: DOMTreeNode['attributes'];
  semantic?: DOMTreeNode['semantic'];
  children: CompressedNode[];
}

export type CompressedTree = CompressedNode;

export interface TreeDistillerConfig {
  maxDepth?: number;
  maxNodes?: number;
  includeInvisible?: boolean;
  prioritySelectors?: string[];
  semanticAnalysis?: boolean;
  async?: boolean;
}

export interface DistilledNode {
  id: string;
  text?: string;
  selector: string;
  rank: number;
  isContainer?: boolean;
  containerType?: string;
  attributes?: {
    testId?: string;
    name?: string;
    placeholder?: string;
    href?: string;
    role?: string;
    type?: string;
    for?: string;
  };
  fingerprint?: string;
}

export interface SemanticFilterConfig {
  minRank?: number;
  includeInvisible?: boolean;
  fiberPropsMap?: Map<string, Record<string, unknown>>;
}

export interface NodeDelta {
  changed: DistilledNode[];
  appeared: DistilledNode[];
  disappeared: string[];
}

