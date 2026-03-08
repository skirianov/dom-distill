/**
 * dom-distill — Live Demo
 *
 * Runs Playwright against real websites, injects dom-distill, and
 * shows the before/after token reduction in the terminal.
 *
 * Usage:
 *   npx tsx examples/demo.ts
 *   npx tsx examples/demo.ts https://news.ycombinator.com
 */

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distillBundle = readFileSync(join(__dirname, '..', 'dist', 'index.mjs'), 'utf8');

// ─── Pretty terminal output ────────────────────────────────────────
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

function bar(value: number, max: number, width = 40): string {
    const filled = Math.round((value / max) * width);
    const empty = width - filled;
    return `${GREEN}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}

function formatTokens(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

// Very rough token estimation (≈ 4 chars per token for English/HTML)
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// ─── Sites to demo ─────────────────────────────────────────────────
const DEFAULT_SITES = [
    { url: 'https://github.com', name: 'GitHub Homepage' },
    { url: 'https://stripe.com', name: 'Stripe' },
    { url: 'https://react.dev', name: 'React Docs' },
    { url: 'https://news.ycombinator.com', name: 'Hacker News' },
];

async function runDemo(targetUrl?: string) {
    const sites = targetUrl
        ? [{ url: targetUrl, name: targetUrl }]
        : DEFAULT_SITES;

    console.log(`\n${BOLD}${CYAN}┌──────────────────────────────────────────────────┐${RESET}`);
    console.log(`${BOLD}${CYAN}│        dom-distill — Live Demo                   │${RESET}`);
    console.log(`${BOLD}${CYAN}└──────────────────────────────────────────────────┘${RESET}\n`);

    const browser = await chromium.launch({ headless: true });

    for (const site of sites) {
        console.log(`${BOLD}${MAGENTA}▸ ${site.name}${RESET} ${DIM}(${site.url})${RESET}`);
        console.log(`${DIM}${'─'.repeat(52)}${RESET}`);

        const page = await browser.newPage();

        try {
            await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            // Give dynamic content a moment to settle
            await page.waitForTimeout(1000);

            // 1. Get raw HTML size
            const rawHtml = await page.content();
            const rawTokens = estimateTokens(rawHtml);
            const rawNodeCount = await page.evaluate(() => document.querySelectorAll('*').length);

            // 2. Inject dom-distill and run it
            const result = await page.evaluate((bundleCode: string) => {
                // Create a module-like scope for the bundle
                const exports: any = {};
                const module = { exports };

                // We need to use the CJS build for page.evaluate
                // Let's inline the distill + filter logic instead
                try {
                    // Use Function constructor to evaluate the bundle
                    const fn = new Function('exports', 'module', bundleCode);
                    fn(exports, module);
                } catch {
                    // If CJS doesn't work, the bundle might be ESM
                    // Fall back to inline implementation
                }

                const lib = module.exports || exports;

                if (!lib.distill) {
                    return { error: 'Failed to load dom-distill bundle' };
                }

                const tree = lib.distill(document.body, { maxDepth: 30, maxNodes: 5000 });
                const filtered = lib.filter(tree, { minRank: 2 });
                const m = lib.metrics(tree);

                return {
                    totalNodes: m.totalNodes,
                    interactiveNodes: m.interactiveNodes,
                    maxDepth: m.maxDepth,
                    avgBranching: m.avgBranchingFactor,
                    filteredCount: filtered.length,
                    filteredJson: JSON.stringify(filtered),
                    // Show first 5 filtered nodes as a preview
                    preview: filtered.slice(0, 5).map((n: any) => ({
                        text: n.text?.slice(0, 40),
                        selector: n.selector,
                        rank: n.rank,
                    })),
                };
            }, readFileSync(join(__dirname, '..', 'dist', 'index.js'), 'utf8'));

            if ('error' in result) {
                console.log(`  ${RED}✗ ${result.error}${RESET}\n`);
                continue;
            }

            const filteredTokens = estimateTokens(result.filteredJson);
            const reduction = ((1 - filteredTokens / rawTokens) * 100);
            const maxTokens = Math.max(rawTokens, filteredTokens);

            // Print results
            console.log(`  ${DIM}Raw DOM:${RESET}        ${BOLD}${rawNodeCount.toLocaleString()}${RESET} nodes  →  ${YELLOW}~${formatTokens(rawTokens)} tokens${RESET}`);
            console.log(`  ${DIM}Distilled:${RESET}      ${BOLD}${result.totalNodes.toLocaleString()}${RESET} nodes  (depth: ${result.maxDepth}, branching: ${result.avgBranching.toFixed(1)})`);
            console.log(`  ${DIM}Filtered:${RESET}       ${BOLD}${result.filteredCount}${RESET} interactive nodes  →  ${GREEN}~${formatTokens(filteredTokens)} tokens${RESET}`);
            console.log();
            console.log(`  ${DIM}Raw tokens:${RESET}      ${bar(rawTokens, maxTokens)} ${YELLOW}${formatTokens(rawTokens)}${RESET}`);
            console.log(`  ${DIM}Filtered tokens:${RESET} ${bar(filteredTokens, maxTokens)} ${GREEN}${formatTokens(filteredTokens)}${RESET}`);
            if (reduction > 0) {
                console.log(`  ${BOLD}${GREEN}Token reduction: ${reduction.toFixed(1)}%${RESET}`);
            } else {
                console.log(`  ${DIM}Token reduction: n/a (link-dense page — raw HTML is already minimal)${RESET}`);
            }
            console.log();

            // Show preview
            console.log(`  ${DIM}Preview (first 5 nodes):${RESET}`);
            for (const node of result.preview) {
                const text = node.text ? ` "${node.text}"` : '';
                console.log(`    ${CYAN}rank:${node.rank}${RESET}  ${BOLD}${node.selector}${RESET}${DIM}${text}${RESET}`);
            }
            console.log();

        } catch (err: any) {
            console.log(`  ${RED}✗ Error: ${err.message}${RESET}\n`);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    console.log(`${DIM}${'─'.repeat(52)}${RESET}`);
    console.log(`${DIM}Done. These are the nodes an LLM would see instead of raw HTML.${RESET}\n`);
}

// ─── Run ────────────────────────────────────────────────────────────
const customUrl = process.argv[2];
runDemo(customUrl).catch(console.error);
