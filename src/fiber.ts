/**
 * React Fiber Tree Scanner
 * 
 * Enhances DOM tree with React component information by analyzing
 * the React Fiber tree. This provides rich component-level context
 * that helps AI understand the application structure better.
 * 
 * Key features:
 * - Extracts component names and props from Fiber nodes
 * - Detects component patterns (forms, navigation, modals, etc.)
 * - Sanitizes props to avoid exposing sensitive data
 * - Maps DOM nodes to their React components
 */

import type { DOMTreeNode } from './types';

// React Fiber types (minimal definitions to avoid React dependency)
interface FiberNode {
    type?: any;
    memoizedProps?: any;
    stateNode?: any;
    child?: FiberNode | null;
    sibling?: FiberNode | null;
    return?: FiberNode | null;
    elementType?: any;
    tag?: number;
    key?: string | null;
}

// Enhanced tree node with React component info
export interface EnhancedDOMTreeNode extends DOMTreeNode {
    componentName?: string;
    componentType?: 'class' | 'function' | 'native' | 'fragment' | 'portal';
    componentProps?: Record<string, any>;
    componentPatterns?: string[];  // e.g., ['form', 'modal', 'navigation']
    reactKey?: string;
    isPortalContent?: boolean;  // True if this node is rendered inside a portal
    portalOrigin?: string;  // Component name that created the portal
}

// React component tags (from React source)
const REACT_TAGS = {
    FunctionComponent: 0,
    ClassComponent: 1,
    IndeterminateComponent: 2,
    HostRoot: 3,
    HostPortal: 4,
    HostComponent: 5,
    HostText: 6,
    Fragment: 7,
    Mode: 8,
    ContextConsumer: 9,
    ContextProvider: 10,
    ForwardRef: 11,
    Profiler: 12,
    SuspenseComponent: 13,
    MemoComponent: 14,
    SimpleMemoComponent: 15,
    LazyComponent: 16
};

/**
 * Find React Fiber root from any DOM element
 */
function findFiberRoot(): FiberNode | null {
    const rootElement = document.getElementById('root') ||
        document.getElementById('__next') ||
        document.querySelector('[data-reactroot]') ||
        document.body.firstElementChild;

    if (!rootElement) return null;

    // React 17+ stores fiber in different property
    const fiberKey = Object.keys(rootElement).find(key =>
        key.startsWith('__reactInternalInstance') ||
        key.startsWith('__reactFiber')
    );

    if (fiberKey) {
        return (rootElement as any)[fiberKey];
    }

    return null;
}

/**
 * Find React Fiber node for a DOM element
 */
function findFiberByDOMNode(domNode: Element): FiberNode | null {
    if (!domNode) return null;

    // Check for fiber property
    const fiberKey = Object.keys(domNode).find(key =>
        key.startsWith('__reactInternalInstance') ||
        key.startsWith('__reactFiber')
    );

    if (fiberKey) {
        const fiber = (domNode as any)[fiberKey];
        // Walk up to find the actual component fiber (not just DOM fiber)
        return findComponentFiber(fiber);
    }

    return null;
}

/**
 * Walk up fiber tree to find component (not DOM) fiber
 */
function findComponentFiber(fiber: FiberNode | null): FiberNode | null {
    let current = fiber;

    while (current) {
        // Found a component fiber
        if (current.tag !== undefined &&
            (current.tag === REACT_TAGS.FunctionComponent ||
                current.tag === REACT_TAGS.ClassComponent ||
                current.tag === REACT_TAGS.ForwardRef ||
                current.tag === REACT_TAGS.MemoComponent ||
                current.tag === REACT_TAGS.SimpleMemoComponent)) {
            return current;
        }

        current = current.return || null;
    }

    return null;
}

/**
 * Get component name from fiber node
 */
function getComponentName(fiber: FiberNode): string {
    if (!fiber.type) return 'Unknown';

    // Function/Class component with name
    if (fiber.type.displayName) return fiber.type.displayName;
    if (fiber.type.name) return fiber.type.name;

    // Wrapped components (memo, forwardRef)
    if (fiber.elementType) {
        if (fiber.elementType.displayName) return fiber.elementType.displayName;
        if (fiber.elementType.name) return fiber.elementType.name;

        // Check render property for forwardRef
        if (fiber.elementType.render) {
            if (fiber.elementType.render.displayName) return fiber.elementType.render.displayName;
            if (fiber.elementType.render.name) return fiber.elementType.render.name;
        }
    }

    // String type (HTML element)
    if (typeof fiber.type === 'string') return fiber.type;

    return 'Component';
}

/**
 * Detect component type from fiber
 */
function detectComponentType(fiber: FiberNode): EnhancedDOMTreeNode['componentType'] {
    if (fiber.tag === undefined || fiber.tag === null) return 'native';

    switch (fiber.tag) {
        case REACT_TAGS.FunctionComponent:
        case REACT_TAGS.SimpleMemoComponent:
        case REACT_TAGS.ForwardRef:
            return 'function';

        case REACT_TAGS.ClassComponent:
            return 'class';

        case REACT_TAGS.Fragment:
            return 'fragment';

        case REACT_TAGS.HostPortal:
            return 'portal';

        default:
            return 'native';
    }
}

/**
 * Sanitize props to avoid exposing sensitive data
 */
function sanitizeProps(props: any): Record<string, any> {
    if (!props || typeof props !== 'object') return {};

    const sanitized: Record<string, any> = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'api'];
    const allowedTypes = ['string', 'number', 'boolean'];

    for (const key in props) {
        // Skip React internal props
        if (key.startsWith('__') || key.startsWith('$$')) continue;

        // Skip functions and complex objects
        const value = props[key];
        if (typeof value === 'function') {
            sanitized[key] = '[Function]';
            continue;
        }

        // Skip sensitive keys
        const keylower = key.toLowerCase();
        if (sensitiveKeys.some(sensitive => keylower.includes(sensitive))) {
            sanitized[key] = '[Redacted]';
            continue;
        }

        // Include simple values
        if (allowedTypes.includes(typeof value)) {
            sanitized[key] = value;
        } else if (Array.isArray(value)) {
            sanitized[key] = `[Array(${value.length})]`;
        } else if (value && typeof value === 'object') {
            sanitized[key] = '[Object]';
        } else {
            sanitized[key] = String(value);
        }
    }

    return sanitized;
}

/**
 * Traverse portal fiber to find its DOM nodes
 * Portals render their children in a different part of the DOM tree,
 * but we need to maintain the component context from where the portal was created.
 */
function traversePortalContent(
    portalFiber: FiberNode,
    originComponentName: string
): { domNodes: Element[]; componentPath: string[] } {
    const domNodes: Element[] = [];
    const componentPath: string[] = [originComponentName];

    // Portal's child contains the actual content
    let current = portalFiber.child;

    while (current) {
        // Collect DOM nodes from portal content
        if (current.tag === REACT_TAGS.HostComponent && current.stateNode) {
            domNodes.push(current.stateNode);
        }

        // Track component hierarchy within portal
        if (current.tag === REACT_TAGS.FunctionComponent ||
            current.tag === REACT_TAGS.ClassComponent ||
            current.tag === REACT_TAGS.ForwardRef ||
            current.tag === REACT_TAGS.MemoComponent) {
            const compName = getComponentName(current);
            if (compName && compName !== 'Unknown') {
                componentPath.push(compName);
            }
        }

        // Traverse depth-first
        if (current.child) {
            current = current.child;
        } else if (current.sibling) {
            current = current.sibling;
        } else {
            // Walk back up to find next sibling
            let parent = current.return;
            while (parent && parent !== portalFiber) {
                if (parent.sibling) {
                    current = parent.sibling;
                    break;
                }
                parent = parent.return || null;
            }
            if (!parent || parent === portalFiber) {
                break;
            }
        }
    }

    return { domNodes, componentPath };
}

/**
 * Detect component patterns from name and props
 */
function detectComponentPatterns(
    name: string,
    props: Record<string, any>,
    domNode: DOMTreeNode
): string[] {
    const patterns: string[] = [];
    const nameLower = name.toLowerCase();

    // Form patterns
    if (nameLower.includes('form') ||
        domNode.tag === 'form' ||
        domNode.semantic?.isForm) {
        patterns.push('form');
    }

    // Modal/Dialog patterns
    if (nameLower.includes('modal') ||
        nameLower.includes('dialog') ||
        nameLower.includes('popup') ||
        props.role === 'dialog') {
        patterns.push('modal');
    }

    // Dropdown patterns (check before navigation to avoid double-matching "DropdownMenu")
    const isDropdown = nameLower.includes('dropdown') ||
        nameLower.includes('combobox') ||
        props.role === 'combobox';

    if (isDropdown) {
        patterns.push('dropdown');
    }

    // Navigation patterns
    if (!isDropdown && (
        nameLower.includes('nav') ||
        nameLower.includes('menu') ||
        nameLower.includes('header') ||
        nameLower.includes('sidebar') ||
        domNode.semantic?.isNavigation
    )) {
        patterns.push('navigation');
    }

    // Button patterns
    if (nameLower.includes('button') ||
        nameLower.includes('btn') ||
        domNode.tag === 'button' ||
        props.role === 'button') {
        patterns.push('button');
    }

    // Input patterns
    if (nameLower.includes('input') ||
        nameLower.includes('field') ||
        nameLower.includes('textbox') ||
        domNode.tag === 'input') {
        patterns.push('input');
    }

    // List patterns
    if (nameLower.includes('list') ||
        nameLower.includes('items') ||
        domNode.tag === 'ul' ||
        domNode.tag === 'ol') {
        patterns.push('list');
    }

    // Card patterns
    if (nameLower.includes('card') ||
        nameLower.includes('tile') ||
        nameLower.includes('panel')) {
        patterns.push('card');
    }

    // Table patterns
    if (nameLower.includes('table') ||
        nameLower.includes('grid') ||
        domNode.tag === 'table') {
        patterns.push('table');
    }

    // Loading patterns
    if (nameLower.includes('loading') ||
        nameLower.includes('spinner') ||
        nameLower.includes('skeleton')) {
        patterns.push('loading');
    }

    return patterns;
}

/**
 * Enhance DOM tree with React Fiber information
 * 
 * @param domTree - The DOM tree to enhance
 * @param portalContext - Context from portal origin (if inside a portal)
 */
export function enhanceTreeWithFiber(
    domTree: DOMTreeNode,
    portalContext?: { origin: string; componentPath: string[] }
): EnhancedDOMTreeNode {
    const enhanced = domTree as EnhancedDOMTreeNode;

    // Get DOM element reference
    const element = domTree.element?.deref();
    if (!element) return enhanced;

    // Find React fiber node
    const fiber = findFiberByDOMNode(element);
    if (!fiber) {
        // If we're in portal context, mark this node
        if (portalContext) {
            enhanced.isPortalContent = true;
            enhanced.portalOrigin = portalContext.origin;
        }

        // Still enhance children even if this node has no fiber
        enhanced.children = enhanced.children.map(child =>
            enhanceTreeWithFiber(child, portalContext)
        );
        return enhanced;
    }

    // Extract component information
    enhanced.componentName = getComponentName(fiber);
    enhanced.componentType = detectComponentType(fiber);
    enhanced.componentProps = sanitizeProps(fiber.memoizedProps);
    enhanced.reactKey = fiber.key || undefined;

    // Handle Portal Detection and Stitching
    if (fiber.tag === REACT_TAGS.HostPortal) {
        // Get portal content while maintaining origin context
        const { domNodes, componentPath } = traversePortalContent(
            fiber,
            enhanced.componentName || 'Portal'
        );

        // Create portal context for children
        const newPortalContext = {
            origin: enhanced.componentName || 'Portal',
            componentPath
        };

        // Mark this node as a portal
        enhanced.componentType = 'portal';

        // Enhance children with portal context
        enhanced.children = enhanced.children.map(child =>
            enhanceTreeWithFiber(child, newPortalContext)
        );

        return enhanced;
    }

    // If we're inside a portal, mark this node
    if (portalContext) {
        enhanced.isPortalContent = true;
        enhanced.portalOrigin = portalContext.origin;
    }

    // Detect component patterns
    enhanced.componentPatterns = detectComponentPatterns(
        enhanced.componentName,
        enhanced.componentProps,
        domTree
    );

    // Update semantic analysis with component info
    if (enhanced.semantic) {
        if (enhanced.componentType === 'function' || enhanced.componentType === 'class') {
            enhanced.semantic.importance += 1;
        }

        // Update intent based on component patterns
        if (enhanced.componentPatterns.includes('form')) {
            enhanced.semantic.isForm = true;
        }
        if (enhanced.componentPatterns.includes('navigation')) {
            enhanced.semantic.isNavigation = true;
        }

        if (enhanced.isPortalContent) {
            enhanced.semantic.isOverlay = true;
            enhanced.semantic.portalOrigin = enhanced.portalOrigin;
            enhanced.semantic.importance += 2;
        }
    }

    // Recursively enhance children, passing portal context if we're in one
    enhanced.children = enhanced.children.map(child =>
        enhanceTreeWithFiber(child, portalContext)
    );

    return enhanced;
}

/**
 * Find all React components in the tree
 */
export function findReactComponents(
    tree: EnhancedDOMTreeNode,
    componentName?: string
): EnhancedDOMTreeNode[] {
    const results: EnhancedDOMTreeNode[] = [];

    function traverse(node: EnhancedDOMTreeNode) {
        if (node.componentName) {
            if (!componentName || node.componentName === componentName) {
                results.push(node);
            }
        }

        node.children.forEach(child => traverse(child as EnhancedDOMTreeNode));
    }

    traverse(tree);
    return results;
}

/**
 * Get component hierarchy from a node
 */
export function getComponentHierarchy(node: EnhancedDOMTreeNode): string[] {
    const hierarchy: string[] = [];
    let current: EnhancedDOMTreeNode | undefined = node;

    while (current) {
        if (current.componentName) {
            hierarchy.unshift(current.componentName);
        }
        current = current.parent as EnhancedDOMTreeNode | undefined;
    }

    return hierarchy;
}

/**
 * Analyze React component tree for patterns
 */
export function analyzeReactPatterns(tree: EnhancedDOMTreeNode): {
    forms: number;
    modals: number;
    navigation: number;
    dropdowns: number;
    lists: number;
    componentTypes: Record<string, number>;
} {
    const stats = {
        forms: 0,
        modals: 0,
        navigation: 0,
        dropdowns: 0,
        lists: 0,
        componentTypes: {} as Record<string, number>
    };

    function traverse(node: EnhancedDOMTreeNode) {
        // Count patterns
        if (node.componentPatterns) {
            if (node.componentPatterns.includes('form')) stats.forms++;
            if (node.componentPatterns.includes('modal')) stats.modals++;
            if (node.componentPatterns.includes('navigation')) stats.navigation++;
            if (node.componentPatterns.includes('dropdown')) stats.dropdowns++;
            if (node.componentPatterns.includes('list')) stats.lists++;
        }

        // Count component types
        if (node.componentName && node.componentType !== 'native') {
            stats.componentTypes[node.componentName] =
                (stats.componentTypes[node.componentName] || 0) + 1;
        }

        node.children.forEach(child => traverse(child as EnhancedDOMTreeNode));
    }

    traverse(tree);
    return stats;
}
