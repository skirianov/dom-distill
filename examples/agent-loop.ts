/**
 * dom-distill — Robust Agent Loop
 *
 * A production-grade AI browser agent using dom-distill:
 *   distill DOM → send to LLM → parse action → execute → repeat
 *
 * Features:
 *   - Scroll support (pages with content below the fold)
 *   - Auto cookie/popup dismissal
 *   - Smart retry on failure (different approach, not same action)
 *   - Proper navigation waits
 *   - Data extraction (agent can "read" and report back)
 *   - Loop detection
 *   - Cumulative token savings tracking
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/agent-loop.ts
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/agent-loop.ts "Go to github.com and find trending repos"
 *
 * With OpenAI directly:
 *   OPENAI_BASE_URL=https://api.openai.com/v1 OPENAI_API_KEY=sk-... npx tsx examples/agent-loop.ts
 */

import { chromium, type Page } from 'playwright';
import { readFileSync } from 'fs';

// ─── Config ─────────────────────────────────────────────────────────
const MAX_STEPS = 15;
const MODEL = process.env.MODEL || 'google/gemini-3.1-flash-lite-preview';
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
const DEFAULT_TASK =
    'Go to https://github.com/trending, find the top trending repo today, and click on it to see its README';

// ─── Pretty output ─────────────────────────────────────────────────
const B = '\x1b[1m';
const D = '\x1b[2m';
const R = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

function fmtTokens(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

// ─── Types ──────────────────────────────────────────────────────────
type Action =
    | { type: 'click'; selector: string }
    | { type: 'type'; selector: string; text: string }
    | { type: 'type_and_submit'; selector: string; text: string }
    | { type: 'press_key'; key: string }
    | { type: 'scroll'; direction: 'up' | 'down' }
    | { type: 'navigate'; url: string }
    | { type: 'extract'; description: string }
    | { type: 'wait'; seconds: number }
    | { type: 'done'; summary: string };

// ─── Token savings tracker ──────────────────────────────────────────
let totalRawTokens = 0;
let totalDistilledTokens = 0;

// ─── Common cookie/popup selectors to auto-dismiss ──────────────────
const COOKIE_SELECTORS = [
    '[id*="cookie"] button[class*="accept"]',
    '[id*="cookie"] button[class*="agree"]',
    '[class*="cookie"] button[class*="accept"]',
    '[class*="cookie-banner"] button',
    '[id*="consent"] button[class*="accept"]',
    'button[id*="accept-cookies"]',
    '[aria-label*="cookie" i] button',
    '[aria-label*="Accept" i]',
    '[data-testid*="cookie"] button',
    '#onetrust-accept-btn-handler',
    '.cc-accept',
    '.cc-dismiss',
];

// ─── LLM call ───────────────────────────────────────────────────────
async function askLLM(
    task: string,
    pageUrl: string,
    pageTitle: string,
    nodes: any[],
    previousActions: string[],
    scrollPosition: string
): Promise<Action> {
    const systemPrompt = `You are a browser automation agent. You receive a task and a list of interactive elements visible on the current page.

Respond with ONLY a JSON object. No markdown, no explanation, no thinking.

Available actions:
- {"type": "click", "selector": "<css selector>"}  — Click an element
- {"type": "type", "selector": "<css selector>", "text": "<text>"}  — Type into a filter/autocomplete input (no submit)
- {"type": "type_and_submit", "selector": "<css selector>", "text": "<text>"}  — Type and press Enter to submit a search form
- {"type": "scroll", "direction": "down"}  — Scroll down to see more content
- {"type": "scroll", "direction": "up"}  — Scroll back up
- {"type": "press_key", "key": "Enter"}  — Press a keyboard key
- {"type": "navigate", "url": "<full url>"}  — Go to a URL
- {"type": "extract", "description": "<what to read>"}  — Read and extract information from the current page
- {"type": "wait", "seconds": 2}  — Wait for dynamic content to load
- {"type": "done", "summary": "<what you accomplished and any extracted data>"}  — Task complete

Rules:
- ONLY use selectors from the provided elements list. NEVER invent selectors.
- Use "scroll" when the content you need might be below the visible area
- Use "extract" to read data from the page before reporting "done"
- Use "type" for live-filter inputs. Use "type_and_submit" for search forms (Google, Wikipedia)
- If a previous action FAILED, try a DIFFERENT approach
- Include any extracted data in the "done" summary`;

    const userPrompt = `Task: ${task}

Page: ${pageUrl}
Title: ${pageTitle}
Scroll: ${scrollPosition}

Previous actions:
${previousActions.length > 0 ? previousActions.map((a, i) => `${i + 1}. ${a}`).join('\n') : '(none)'}

Interactive elements (${nodes.length} nodes):
${JSON.stringify(nodes, null, 2)}

Next action (JSON only):`;

    const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0,
            max_tokens: 300,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`LLM API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();

    // Strip thinking tags (some models like qwen wrap in <think>)
    const cleaned = content
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim();

    return JSON.parse(cleaned) as Action;
}

// ─── Distill the page ───────────────────────────────────────────────
interface DistillResult {
    nodes: any[];
    rawTokens: number;
    distilledTokens: number;
    rawNodes: number;
    pageTitle: string;
    scrollPosition: string;
}

async function distillPage(page: Page): Promise<DistillResult> {
    const bundleCode = readFileSync('./dist/index.js', 'utf8');

    const result = await page.evaluate((code: string) => {
        const exports: any = {};
        const module = { exports };
        new Function('exports', 'module', code)(exports, module);
        const lib = module.exports || exports;

        const rawHtmlLength = document.documentElement.outerHTML.length;
        const rawNodeCount = document.querySelectorAll('*').length;

        const tree = lib.distill(document.body, { maxDepth: 20, maxNodes: 3000 });
        const filtered = lib.filter(tree, { minRank: 2 });

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

        return {
            nodes,
            rawHtmlLength,
            rawNodeCount,
            distilledJson: JSON.stringify(nodes),
            pageTitle: document.title,
            scrollPosition: `${scrollPct}% (${Math.round(scrollTop)}px of ${scrollHeight}px)`,
        };
    }, bundleCode);

    return {
        nodes: result.nodes,
        rawTokens: Math.ceil(result.rawHtmlLength / 4),
        distilledTokens: Math.ceil(result.distilledJson.length / 4),
        rawNodes: result.rawNodeCount,
        pageTitle: result.pageTitle,
        scrollPosition: result.scrollPosition,
    };
}

// ─── Auto-dismiss cookie banners ────────────────────────────────────
async function dismissCookies(page: Page): Promise<boolean> {
    for (const selector of COOKIE_SELECTORS) {
        try {
            const el = await page.$(selector);
            if (el && await el.isVisible()) {
                await el.click({ timeout: 2000 });
                return true;
            }
        } catch { /* ignore */ }
    }
    return false;
}

// ─── Execute an action ──────────────────────────────────────────────
async function executeAction(page: Page, action: Action): Promise<string> {
    switch (action.type) {
        case 'click':
            await page.click(action.selector, { timeout: 5000, force: true });
            await page.waitForTimeout(500);
            return `Clicked "${action.selector}"`;

        case 'type': {
            const text = action.text.replace(/\n$/, '');
            await page.fill(action.selector, text, { timeout: 5000 });
            await page.waitForTimeout(800); // wait for autocomplete/filter
            return `Typed "${text}" into "${action.selector}"`;
        }

        case 'type_and_submit': {
            const text = action.text.replace(/\n$/, '');
            await page.fill(action.selector, text, { timeout: 5000 });
            await page.press(action.selector, 'Enter');
            await page.waitForLoadState('domcontentloaded').catch(() => { });
            return `Typed "${text}" and submitted`;
        }

        case 'press_key':
            await page.keyboard.press(action.key);
            return `Pressed ${action.key}`;

        case 'scroll':
            if (action.direction === 'down') {
                await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
            } else {
                await page.evaluate(() => window.scrollBy(0, -window.innerHeight * 0.8));
            }
            await page.waitForTimeout(500);
            return `Scrolled ${action.direction}`;

        case 'navigate':
            await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(1000);
            // Auto-dismiss cookies on new pages
            const dismissed = await dismissCookies(page);
            return `Navigated to ${action.url}${dismissed ? ' (dismissed cookie banner)' : ''}`;

        case 'extract': {
            // Get visible text content for the LLM to read
            const text = await page.evaluate(() => {
                const main = document.querySelector('main') || document.querySelector('article') || document.body;
                return main.innerText?.slice(0, 2000) || '';
            });
            return `Extracted content: "${text.slice(0, 200)}..."`;
        }

        case 'wait':
            await page.waitForTimeout(Math.min(action.seconds * 1000, 5000));
            return `Waited ${action.seconds}s`;

        case 'done':
            return `Done: ${action.summary}`;

        default:
            throw new Error(`Unknown action type: ${(action as any).type}`);
    }
}

// ─── Main agent loop ────────────────────────────────────────────────
async function runAgent(task: string) {
    if (!API_KEY) {
        console.error(`${RED}Error: OPENROUTER_API_KEY environment variable is required.${R}`);
        console.error(`${D}Usage: OPENROUTER_API_KEY=sk-or-... npx tsx examples/agent-loop.ts${R}`);
        process.exit(1);
    }

    console.log(`\n${B}${CYAN}┌──────────────────────────────────────────────────────┐${R}`);
    console.log(`${B}${CYAN}│   dom-distill — Agent Loop                           │${R}`);
    console.log(`${B}${CYAN}└──────────────────────────────────────────────────────┘${R}\n`);
    console.log(`${D}Task:${R}  ${B}${task}${R}`);
    console.log(`${D}Model:${R} ${MODEL}`);
    console.log(`${D}Max steps:${R} ${MAX_STEPS}\n`);

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const previousActions: string[] = [];
    let completedSteps = 0;
    let lastActionStr = '';
    let consecutiveFailures = 0;

    for (let step = 1; step <= MAX_STEPS; step++) {
        console.log(`${B}${MAGENTA}── Step ${step} ──${R}`);

        // 1. Distill the current page
        const currentUrl = page.url();

        let distillResult: DistillResult;
        try {
            distillResult = await distillPage(page);
        } catch {
            distillResult = {
                nodes: [], rawTokens: 0, distilledTokens: 0,
                rawNodes: 0, pageTitle: '', scrollPosition: '0%',
            };
        }

        const { nodes, rawTokens, distilledTokens, rawNodes, pageTitle, scrollPosition } = distillResult;

        // Track cumulative savings
        totalRawTokens += rawTokens;
        totalDistilledTokens += distilledTokens;

        if (rawTokens > 0) {
            const saved = rawTokens - distilledTokens;
            const pct = ((saved / rawTokens) * 100).toFixed(1);
            console.log(`${D}  Page:${R} ${pageTitle || currentUrl}`);
            console.log(`${D}  DOM:${R} ${rawNodes} nodes → ${nodes.length} interactive ${D}(${YELLOW}~${fmtTokens(rawTokens)}${D} raw → ${GREEN}~${fmtTokens(distilledTokens)}${D} distilled, ${B}${GREEN}${pct}% saved${R}${D})${R}`);
        } else {
            console.log(`${D}  Page:${R} ${currentUrl}`);
            console.log(`${D}  Distilled:${R} ${nodes.length} interactive nodes`);
        }

        // 2. Ask the LLM
        console.log(`${D}  Thinking...${R}`);
        let action: Action;
        try {
            action = await askLLM(task, currentUrl, pageTitle, nodes, previousActions, scrollPosition);
        } catch (err: any) {
            console.error(`${RED}  LLM error: ${err.message}${R}`);
            break;
        }

        // 3. Show decision
        const actionStr = JSON.stringify(action);
        console.log(`${YELLOW}  Action:${R} ${B}${actionStr}${R}`);

        // Loop detection
        if (actionStr === lastActionStr) {
            console.log(`${RED}  ✗ Loop detected — same action repeated. Stopping.${R}\n`);
            break;
        }
        lastActionStr = actionStr;

        // 4. Execute
        try {
            const result = await executeAction(page, action);
            console.log(`${GREEN}  ✓ ${result}${R}\n`);
            previousActions.push(result);
            completedSteps = step;
            consecutiveFailures = 0;

            if (action.type === 'done') {
                break;
            }

        } catch (err: any) {
            const msg = err.message.split('\n')[0]; // first line only
            console.error(`${RED}  ✗ Failed: ${msg}${R}\n`);
            previousActions.push(`FAILED: ${msg}`);
            consecutiveFailures++;

            if (consecutiveFailures >= 3) {
                console.log(`${RED}  ✗ 3 consecutive failures. Stopping.${R}\n`);
                break;
            }
        }
    }

    // ─── Summary ────────────────────────────────────────────────────
    console.log(`${B}${CYAN}┌──────────────────────────────────────────────────────┐${R}`);
    console.log(`${B}${CYAN}│   Summary                                           │${R}`);
    console.log(`${B}${CYAN}└──────────────────────────────────────────────────────┘${R}`);
    console.log(`${D}  Steps completed:${R}  ${B}${completedSteps}${R}`);

    if (totalRawTokens > 0) {
        const totalSaved = totalRawTokens - totalDistilledTokens;
        const totalPct = ((totalSaved / totalRawTokens) * 100).toFixed(1);
        console.log(`${D}  Without dom-distill:${R} ${YELLOW}~${fmtTokens(totalRawTokens)} tokens${R} sent to LLM`);
        console.log(`${D}  With dom-distill:${R}    ${GREEN}~${fmtTokens(totalDistilledTokens)} tokens${R} sent to LLM`);
        console.log(`${D}  Total saved:${R}         ${B}${GREEN}~${fmtTokens(totalSaved)} tokens (${totalPct}%)${R}`);
    }
    console.log();

    console.log(`${D}Browser will close in 3 seconds...${R}`);
    await page.waitForTimeout(3000);
    await browser.close();
}

// ─── Run ────────────────────────────────────────────────────────────
const task = process.argv[2] || DEFAULT_TASK;
runAgent(task).catch(console.error);
