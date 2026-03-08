/**
 * dom-distill — Agent Loop Cookbook
 *
 * A complete working example of an AI browser agent using dom-distill:
 *   distill DOM → send to LLM → parse action → execute → repeat
 *
 * Works with any OpenAI-compatible API (OpenRouter, OpenAI, local models, etc.)
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/agent-loop.ts
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/agent-loop.ts "Go to github.com and find the trending repos"
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
    | { type: 'navigate'; url: string }
    | { type: 'done'; summary: string };

// ─── Token savings tracker ──────────────────────────────────────────
let totalRawTokens = 0;
let totalDistilledTokens = 0;

// ─── LLM call ───────────────────────────────────────────────────────
async function askLLM(
    task: string,
    pageUrl: string,
    nodes: any[],
    previousActions: string[]
): Promise<Action> {
    const systemPrompt = `You are a browser automation agent. You receive a task and a list of interactive elements on the current page. Each element has text, selector, rank, and attributes.

Your job is to decide the NEXT SINGLE ACTION to take. Respond with ONLY a JSON object, no markdown, no explanation.

Available actions:
- {"type": "click", "selector": "<css selector>"}  — Click an element
- {"type": "type", "selector": "<css selector>", "text": "<text>"}  — Type into an input (for live search filters, autocomplete)
- {"type": "type_and_submit", "selector": "<css selector>", "text": "<text>"}  — Type and press Enter (for search forms like Google, Wikipedia)
- {"type": "press_key", "key": "Enter"}  — Press a keyboard key
- {"type": "navigate", "url": "<full url>"}  — Navigate to a URL
- {"type": "done", "summary": "<what you accomplished>"}  — Task is complete

Rules:
- ONLY use selectors from the provided elements list. NEVER invent or guess selectors.
- Use "type" for live filter inputs (results update as you type). Use "type_and_submit" for traditional search forms (Google, Wikipedia, etc.)
- If the task requires navigating to a site first, use "navigate"
- When the task goal is achieved, respond with "done"
- If a previous action FAILED, try a different approach — do NOT repeat the same action`;

    const userPrompt = `Task: ${task}

Current page: ${pageUrl}

Previous actions taken:
${previousActions.length > 0 ? previousActions.map((a, i) => `${i + 1}. ${a}`).join('\n') : '(none)'}

Interactive elements on this page (${nodes.length} nodes):
${JSON.stringify(nodes, null, 2)}

What is the next action?`;

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
            max_tokens: 256,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`LLM API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();

    // Parse JSON — handle models that wrap in ```json
    const jsonStr = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(jsonStr) as Action;
}

// ─── Distill the page ───────────────────────────────────────────────
interface DistillResult {
    nodes: any[];
    rawTokens: number;
    distilledTokens: number;
    rawNodes: number;
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

        return {
            nodes,
            rawHtmlLength,
            rawNodeCount,
            distilledJson: JSON.stringify(nodes),
        };
    }, bundleCode);

    return {
        nodes: result.nodes,
        rawTokens: Math.ceil(result.rawHtmlLength / 4),
        distilledTokens: Math.ceil(result.distilledJson.length / 4),
        rawNodes: result.rawNodeCount,
    };
}

// ─── Execute an action ──────────────────────────────────────────────
async function executeAction(page: Page, action: Action): Promise<string> {
    switch (action.type) {
        case 'click':
            await page.click(action.selector, { timeout: 5000, force: true });
            return `Clicked "${action.selector}"`;

        case 'type': {
            const text = action.text.replace(/\n$/, '');
            await page.fill(action.selector, text, { timeout: 5000 });
            return `Typed "${text}" into "${action.selector}"`;
        }

        case 'type_and_submit': {
            const text = action.text.replace(/\n$/, '');
            await page.fill(action.selector, text, { timeout: 5000 });
            await page.press(action.selector, 'Enter');
            return `Typed "${text}" and pressed Enter`;
        }

        case 'press_key':
            await page.keyboard.press(action.key);
            return `Pressed ${action.key}`;

        case 'navigate':
            await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            return `Navigated to ${action.url}`;

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

    const browser = await chromium.launch({ headless: false }); // visible so you can watch!
    const page = await browser.newPage();

    const previousActions: string[] = [];
    let completedSteps = 0;
    let lastActionStr = '';

    for (let step = 1; step <= MAX_STEPS; step++) {
        console.log(`${B}${MAGENTA}── Step ${step} ──${R}`);

        // 1. Distill the current page
        const currentUrl = page.url();
        console.log(`${D}  Page:${R} ${currentUrl}`);

        let distillResult: DistillResult;
        try {
            distillResult = await distillPage(page);
        } catch {
            distillResult = { nodes: [], rawTokens: 0, distilledTokens: 0, rawNodes: 0 };
        }

        const { nodes, rawTokens, distilledTokens, rawNodes } = distillResult;

        // Track cumulative savings
        totalRawTokens += rawTokens;
        totalDistilledTokens += distilledTokens;

        if (rawTokens > 0) {
            const saved = rawTokens - distilledTokens;
            const pct = ((saved / rawTokens) * 100).toFixed(1);
            console.log(`${D}  DOM:${R} ${rawNodes} nodes → ${nodes.length} interactive ${D}(${YELLOW}~${fmtTokens(rawTokens)}${D} raw → ${GREEN}~${fmtTokens(distilledTokens)}${D} distilled, ${B}${GREEN}${pct}% saved${R}${D})${R}`);
        } else {
            console.log(`${D}  Distilled:${R} ${nodes.length} interactive nodes`);
        }

        // 2. Ask the LLM what to do
        console.log(`${D}  Thinking...${R}`);
        let action: Action;
        try {
            action = await askLLM(task, currentUrl, nodes, previousActions);
        } catch (err: any) {
            console.error(`${RED}  LLM error: ${err.message}${R}`);
            break;
        }

        // 3. Show the decision
        const actionStr = JSON.stringify(action);
        console.log(`${YELLOW}  Action:${R} ${B}${actionStr}${R}`);

        // Loop detection — if same action repeated, bail
        if (previousActions.length > 0 && actionStr === lastActionStr) {
            console.log(`${RED}  ✗ Loop detected — same action repeated. Stopping.${R}\n`);
            break;
        }
        lastActionStr = actionStr;

        // 4. Execute it
        try {
            const result = await executeAction(page, action);
            console.log(`${GREEN}  ✓ ${result}${R}\n`);
            previousActions.push(result);
            completedSteps = step;

            if (action.type === 'done') {
                break;
            }

            // Wait for page to settle after action
            await page.waitForTimeout(1500);

        } catch (err: any) {
            console.error(`${RED}  ✗ Action failed: ${err.message}${R}\n`);
            previousActions.push(`FAILED: ${err.message}`);
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

    // Keep browser open briefly so user can see the result
    console.log(`${D}Browser will close in 3 seconds...${R}`);
    await page.waitForTimeout(3000);
    await browser.close();
}

// ─── Run ────────────────────────────────────────────────────────────
const task = process.argv[2] || DEFAULT_TASK;
runAgent(task).catch(console.error);
