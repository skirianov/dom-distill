import { JSDOM } from 'jsdom';
import { distill, filter, compress } from './src';

// Very rough approximation of LLM token counting.
// Typically 1 token ~= 4 characters for English text/code.
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

async function runBenchmark(url: string) {
    console.log(`\n\x1b[36mRunning benchmark for: ${url}\x1b[0m`);

    // 1. Fetch raw HTML
    console.log('Fetching HTML...');
    const response = await fetch(url);
    const html = await response.text();

    // 2. Parse with jsdom
    console.log('Parsing DOM...');
    const dom = new JSDOM(html, { url });

    // Setup global mocks needed by dom-distill in a jsdom environment
    global.document = dom.window.document;
    global.window = dom.window as any;

    // Provide basic visibility mocks otherwise all nodes rank 0
    global.getComputedStyle = (element: Element) => {
        return {
            display: 'block',
            visibility: 'visible',
            opacity: '1'
        } as any;
    };

    global.Node = dom.window.Node;
    global.Element = dom.window.Element;
    global.CSS = { escape: (s: string) => s } as any;

    // Mock getBoundingClientRect
    dom.window.Element.prototype.getBoundingClientRect = function () {
        return { width: 100, height: 50, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) };
    };

    // 3. Measure raw limits
    const allNodesCount = document.querySelectorAll('*').length;
    const rawHtmlBytes = Buffer.byteLength(html, 'utf8');
    const rawHtmlTokens = estimateTokens(html);

    // 4. Distill 
    console.log('Distilling...');
    const startDistill = performance.now();
    const tree = distill(document.body, {
        maxDepth: 30,
        maxNodes: 5000,
        includeInvisible: false
    });
    const distillTime = performance.now() - startDistill;

    // 5. Filter
    const startFilter = performance.now();
    const filteredNodes = filter(tree, { minRank: 2 });
    const filterTime = performance.now() - startFilter;

    // 6. Measure distilled bounds
    const compressed = compress(tree);
    const compressedJson = JSON.stringify(compressed);
    const filteredJson = JSON.stringify(filteredNodes);

    const compressedTokens = estimateTokens(compressedJson);
    const filteredTokens = estimateTokens(filteredJson);

    // Print Results
    console.log('\n\x1b[33m--- Results ---\x1b[0m');
    console.log(`Raw DOM nodes:      ${allNodesCount.toLocaleString()}`);
    console.log(`Raw HTML size:      ${(rawHtmlBytes / 1024).toFixed(1)} KB`);
    console.log(`Raw HTML tokens:    ~${rawHtmlTokens.toLocaleString()}\n`);

    console.log(`Distill time:       ${distillTime.toFixed(1)} ms`);
    console.log(`Filter time:        ${filterTime.toFixed(1)} ms\n`);

    console.log(`\x1b[32m[Tree Compression]\x1b[0m`);
    console.log(`Compressed tokens:  ~${compressedTokens.toLocaleString()} (${((compressedTokens / rawHtmlTokens) * 100).toFixed(1)}% of raw)`);

    console.log(`\n\x1b[32m[High-Value Interactive Filtered]\x1b[0m`);
    console.log(`Interactive nodes:  ${filteredNodes.length.toLocaleString()}`);
    console.log(`Filtered tokens:    ~${filteredTokens.toLocaleString()} (${((filteredTokens / rawHtmlTokens) * 100).toFixed(2)}% of raw)`);
}

async function main() {
    await runBenchmark('https://github.com');
    await runBenchmark('https://news.ycombinator.com');
    await runBenchmark('https://en.wikipedia.org/wiki/Document_Object_Model');
    await runBenchmark('https://react.dev/');
    await runBenchmark('https://stripe.com');
    await runBenchmark('https://github.com/microsoft/TypeScript');
}

main().catch(console.error);
