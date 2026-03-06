import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { distill } from '../src/distiller';
import {
    enhanceTreeWithFiber,
    findReactComponents,
    getComponentHierarchy,
    analyzeReactPatterns,
    type EnhancedDOMTreeNode
} from '../src/fiber';

function LoginForm() { }
LoginForm.displayName = 'LoginForm';

function NavBar() { }
NavBar.displayName = 'NavBar';

function ModalDialog() { }
ModalDialog.displayName = 'ModalDialog';

function DropdownMenu() { }
DropdownMenu.displayName = 'DropdownMenu';

function CardList() { }
CardList.displayName = 'CardList';

const REACT_TAGS = {
    FunctionComponent: 0,
    ClassComponent: 1,
    HostComponent: 5,
    HostPortal: 4,
    ForwardRef: 11,
    MemoComponent: 14,
    SimpleMemoComponent: 15,
};

function attachFiber(element: Element, fiber: Record<string, any>) {
    (element as any).__reactFiber$test = fiber;
}

function makeFiber(
    type: any,
    tag: number,
    props: Record<string, any> = {},
    opts: { key?: string; stateNode?: any; child?: any; sibling?: any; return?: any } = {}
) {
    return {
        type,
        tag,
        memoizedProps: props,
        elementType: type,
        key: opts.key ?? null,
        stateNode: opts.stateNode ?? null,
        child: opts.child ?? null,
        sibling: opts.sibling ?? null,
        return: opts.return ?? null,
    };
}

describe('enhanceTreeWithFiber', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    it('extracts component name and type from fiber', () => {
        container.innerHTML = '<form><input type="text" name="user" /></form>';
        const form = container.querySelector('form')!;

        attachFiber(form, makeFiber(LoginForm, REACT_TAGS.FunctionComponent, { onSubmit: () => { } }));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const formNode = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(formNode.componentName).toBe('LoginForm');
        expect(formNode.componentType).toBe('function');
    });

    it('sanitizes props and redacts sensitive values', () => {
        container.innerHTML = '<form></form>';
        const form = container.querySelector('form')!;

        attachFiber(form, makeFiber(LoginForm, REACT_TAGS.FunctionComponent, {
            username: 'admin',
            password: 'secret123',
            apiKey: 'sk-abc',
            count: 42,
            disabled: false,
            items: [1, 2, 3],
            config: { nested: true },
            onSubmit: () => { },
        }));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const formNode = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(formNode.componentProps?.username).toBe('admin');
        expect(formNode.componentProps?.password).toBe('[Redacted]');
        expect(formNode.componentProps?.apiKey).toBe('[Redacted]');
        expect(formNode.componentProps?.count).toBe(42);
        expect(formNode.componentProps?.disabled).toBe(false);
        expect(formNode.componentProps?.items).toBe('[Array(3)]');
        expect(formNode.componentProps?.config).toBe('[Object]');
        expect(formNode.componentProps?.onSubmit).toBe('[Function]');
    });

    it('detects form pattern from component name', () => {
        container.innerHTML = '<form></form>';
        const form = container.querySelector('form')!;
        attachFiber(form, makeFiber(LoginForm, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const formNode = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(formNode.componentPatterns).toContain('form');
    });

    it('detects modal pattern from component name', () => {
        container.innerHTML = '<div role="dialog"></div>';
        const dialog = container.querySelector('[role="dialog"]')!;
        attachFiber(dialog, makeFiber(ModalDialog, REACT_TAGS.FunctionComponent, { role: 'dialog' }));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const dialogNode = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(dialogNode.componentPatterns).toContain('modal');
    });

    it('detects navigation pattern', () => {
        container.innerHTML = '<nav></nav>';
        const nav = container.querySelector('nav')!;
        attachFiber(nav, makeFiber(NavBar, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const navNode = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(navNode.componentPatterns).toContain('navigation');
    });

    it('detects dropdown pattern', () => {
        container.innerHTML = '<div></div>';
        const div = container.querySelector('div')!;
        attachFiber(div, makeFiber(DropdownMenu, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const node = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(node.componentPatterns).toContain('dropdown');
    });

    it('preserves react key', () => {
        container.innerHTML = '<li>Item</li>';
        const li = container.querySelector('li')!;
        attachFiber(li, makeFiber(CardList, REACT_TAGS.FunctionComponent, {}, { key: 'item-42' }));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const node = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(node.reactKey).toBe('item-42');
    });

    it('enhances children recursively', () => {
        container.innerHTML = '<nav><a href="/">Home</a></nav>';
        const nav = container.querySelector('nav')!;
        const link = container.querySelector('a')!;

        attachFiber(nav, makeFiber(NavBar, REACT_TAGS.FunctionComponent));

        function NavLink() { }
        NavLink.displayName = 'NavLink';
        attachFiber(link, makeFiber(NavLink, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const navNode = enhanced.children[0] as EnhancedDOMTreeNode;
        const linkNode = navNode.children[0] as EnhancedDOMTreeNode;

        expect(navNode.componentName).toBe('NavBar');
        expect(linkNode.componentName).toBe('NavLink');
    });

    it('handles nodes without fiber gracefully', () => {
        container.innerHTML = '<div><span>Plain text</span></div>';

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);

        expect(enhanced.componentName).toBeUndefined();
        expect(enhanced.children[0]).toBeDefined();
    });

    it('boosts semantic importance for named components', () => {
        container.innerHTML = '<form></form>';
        const form = container.querySelector('form')!;
        attachFiber(form, makeFiber(LoginForm, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const baseImportance = tree.children[0]!.semantic!.importance;

        const enhanced = enhanceTreeWithFiber(tree);
        const formNode = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(formNode.semantic!.importance).toBeGreaterThan(baseImportance);
    });

    it('handles class components', () => {
        container.innerHTML = '<div></div>';
        const div = container.querySelector('div')!;

        function MyClassComponent() { }
        MyClassComponent.displayName = 'MyClassComponent';
        attachFiber(div, makeFiber(MyClassComponent, REACT_TAGS.ClassComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const node = enhanced.children[0] as EnhancedDOMTreeNode;

        expect(node.componentType).toBe('class');
        expect(node.componentName).toBe('MyClassComponent');
    });
});

describe('findReactComponents', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    it('finds all components in the tree', () => {
        container.innerHTML = '<nav></nav><form></form>';
        const nav = container.querySelector('nav')!;
        const form = container.querySelector('form')!;

        attachFiber(nav, makeFiber(NavBar, REACT_TAGS.FunctionComponent));
        attachFiber(form, makeFiber(LoginForm, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const components = findReactComponents(enhanced);

        expect(components.length).toBe(2);
        const names = components.map(c => c.componentName);
        expect(names).toContain('NavBar');
        expect(names).toContain('LoginForm');
    });

    it('filters components by name', () => {
        container.innerHTML = '<nav></nav><form></form>';
        const nav = container.querySelector('nav')!;
        const form = container.querySelector('form')!;

        attachFiber(nav, makeFiber(NavBar, REACT_TAGS.FunctionComponent));
        attachFiber(form, makeFiber(LoginForm, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const forms = findReactComponents(enhanced, 'LoginForm');

        expect(forms.length).toBe(1);
        expect(forms[0]!.componentName).toBe('LoginForm');
    });
});

describe('getComponentHierarchy', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    it('returns hierarchy from leaf to root', () => {
        container.innerHTML = '<nav><a href="/">Home</a></nav>';
        const nav = container.querySelector('nav')!;
        const link = container.querySelector('a')!;

        attachFiber(nav, makeFiber(NavBar, REACT_TAGS.FunctionComponent));
        function NavLink() { }
        NavLink.displayName = 'NavLink';
        attachFiber(link, makeFiber(NavLink, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const linkNode = (enhanced.children[0] as EnhancedDOMTreeNode).children[0] as EnhancedDOMTreeNode;

        const hierarchy = getComponentHierarchy(linkNode);
        expect(hierarchy).toEqual(['NavBar', 'NavLink']);
    });

    it('returns empty array for nodes without components', () => {
        container.innerHTML = '<div><span>text</span></div>';
        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);

        const hierarchy = getComponentHierarchy(enhanced);
        expect(hierarchy).toEqual([]);
    });
});

describe('analyzeReactPatterns', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    it('counts patterns across the tree', () => {
        container.innerHTML = '<nav></nav><form></form><div></div>';
        const nav = container.querySelector('nav')!;
        const form = container.querySelector('form')!;
        const div = container.querySelector('div')!;

        attachFiber(nav, makeFiber(NavBar, REACT_TAGS.FunctionComponent));
        attachFiber(form, makeFiber(LoginForm, REACT_TAGS.FunctionComponent));
        attachFiber(div, makeFiber(DropdownMenu, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const stats = analyzeReactPatterns(enhanced);

        expect(stats.forms).toBe(1);
        expect(stats.navigation).toBe(1);
        expect(stats.dropdowns).toBe(1);
        expect(stats.componentTypes['NavBar']).toBe(1);
        expect(stats.componentTypes['LoginForm']).toBe(1);
        expect(stats.componentTypes['DropdownMenu']).toBe(1);
    });

    it('counts component type occurrences', () => {
        container.innerHTML = '<span></span><span></span>';
        const spans = container.querySelectorAll('span');

        function CardItem() { }
        CardItem.displayName = 'CardItem';
        attachFiber(spans[0]!, makeFiber(CardItem, REACT_TAGS.FunctionComponent));
        attachFiber(spans[1]!, makeFiber(CardItem, REACT_TAGS.FunctionComponent));

        const tree = distill(container);
        const enhanced = enhanceTreeWithFiber(tree);
        const stats = analyzeReactPatterns(enhanced);

        expect(stats.componentTypes['CardItem']).toBe(2);
    });
});
