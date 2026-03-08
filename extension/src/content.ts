import { distill, filter } from 'dom-distill';

declare global {
    interface Window {
        _DOM_DISTILL_AGENT_INJECTED?: boolean;
    }
}

if (!window._DOM_DISTILL_AGENT_INJECTED) {
    window._DOM_DISTILL_AGENT_INJECTED = true;

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'DISTILL') {
            (async () => {
                try {
                    const rawHtmlLength = document.documentElement.outerHTML.length;
                    const rawNodeCount = document.querySelectorAll('*').length;

                    const tree = distill(document.body, { maxDepth: 30, maxNodes: 10000 });
                    const filtered = filter(tree, { minRank: 2 });

                    const nodes = filtered.map((n: any) => ({
                        text: n.text,
                        selector: n.selector,
                        rank: n.rank,
                        attributes: n.attributes,
                    }));

                    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
                    const scrollHeight = document.documentElement.scrollHeight;
                    const clientHeight = document.documentElement.clientHeight;
                    const scrollPct = scrollHeight > clientHeight
                        ? Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)
                        : 0;

                    const result = {
                        nodes,
                        rawTokens: Math.ceil(rawHtmlLength / 4),
                        distilledTokens: Math.ceil(JSON.stringify(nodes).length / 4),
                        rawNodes: rawNodeCount,
                        pageTitle: document.title,
                        scrollPosition: `${scrollPct}% (${Math.round(scrollTop)}px of ${scrollHeight}px)`,
                    };
                    sendResponse({ success: true, data: result });
                } catch (err: any) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true; // Keep channel open for async
        }

        if (msg.type === 'EXECUTE') {
            (async () => {
                try {
                    const res = await executeAction(msg.action);
                    sendResponse({ success: true, result: res });
                } catch (err: any) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true; // Keep channel open for async
        }
    });

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    async function executeAction(action: any): Promise<string> {
        let el: HTMLElement | null = null;

        if (action.selector) {
            const elements = document.querySelectorAll(action.selector);
            if (elements.length > 0) {
                el = elements[0] as HTMLElement;
                if (action.elementText) {
                    const targetText = action.elementText.trim().toLowerCase();
                    for (const possibleEl of Array.from(elements)) {
                        const t = ((possibleEl as HTMLElement).innerText || possibleEl.textContent || '').trim().toLowerCase();
                        if (t === targetText || t.includes(targetText) || targetText.includes(t)) {
                            el = possibleEl as HTMLElement;
                            break;
                        }
                    }
                }
            }
        }

        switch (action.type) {
            case 'click':
                if (!el) throw new Error(`Element ${action.selector} not found`);

                el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
                await sleep(100);

                if (el.tagName.toLowerCase() === 'a' && (el as HTMLAnchorElement).target === '_blank') {
                    (el as HTMLAnchorElement).target = '_self';
                }

                // Dispatch full mouse events for React/Vue SPAs
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                el.click();

                await sleep(500);
                return `Clicked "${action.selector}"`;

            case 'type':
                if (!el) throw new Error(`Element ${action.selector} not found`);
                el.focus();

                if (el instanceof HTMLInputElement) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    if (setter) setter.call(el, action.text);
                    else el.value = action.text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (el instanceof HTMLTextAreaElement) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                    if (setter) setter.call(el, action.text);
                    else el.value = action.text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (el.isContentEditable) {
                    el.focus();
                    try {
                        document.execCommand('selectAll', false, undefined);
                        document.execCommand('insertText', false, action.text);
                    } catch (e) {
                        el.innerText = action.text;
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }

                await sleep(800);
                return `Typed "${action.text}" into "${action.selector}"`;

            case 'type_and_submit':
                if (!el) throw new Error(`Element ${action.selector} not found`);
                el.focus();

                if (el instanceof HTMLInputElement) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    if (setter) setter.call(el, action.text);
                    else el.value = action.text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (el instanceof HTMLTextAreaElement) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                    if (setter) setter.call(el, action.text);
                    else el.value = action.text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (el.isContentEditable) {
                    el.focus();
                    try {
                        document.execCommand('selectAll', false, undefined);
                        document.execCommand('insertText', false, action.text);
                    } catch (e) {
                        el.innerText = action.text;
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }

                await sleep(200);

                // Dispatch enter key events (works for textareas & SPAs)
                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));

                const form = el.closest('form');
                if (form) {
                    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                }

                await sleep(500);
                return `Typed "${action.text}" and submitted`;

            case 'press_key':
                document.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, bubbles: true }));
                return `Pressed ${action.key}`;

            case 'scroll':
                if (action.direction === 'down') {
                    window.scrollBy(0, window.innerHeight * 0.8);
                } else {
                    window.scrollBy(0, -window.innerHeight * 0.8);
                }
                await sleep(500);
                return `Scrolled ${action.direction}`;

            case 'navigate':
                window.location.href = action.url;
                await sleep(5000); // we will unload soon anyway
                return `Navigated to ${action.url}`;

            case 'extract':
                const main = document.querySelector('main') || document.querySelector('article') || document.body;
                const text = (main.innerText || main.textContent)?.trim().slice(0, 4000) || '';
                return `Extracted content:\n${text}`;

            case 'wait':
                await sleep(Math.min(action.seconds * 1000, 5000));
                return `Waited ${action.seconds}s`;

            case 'done':
                return `Done: ${action.summary}`;

            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }
}
