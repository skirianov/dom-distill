# dom-distill

Token-efficient DOM-to-tree distiller for LLMs and browser automation.

## The problem it solves for AI Agents

Right now, open-source AI agents (like AutoGPT, Skyvern, or standard browser-use scripts) struggle with the same massive bottleneck: **bloated DOMs.**

A modern React or Next.js app often contains **2,000+ DOM nodes**. If you serialize that and send it to current-generation models like Claude 4.6 Sonnet/Opus, Gemini 3.1, or GPT-5.4, it consumes **~100,000 to 150,000 tokens** per step. 
- It burns through API credits.
- It destroys request latency.
- It confuses the model with thousands of hidden `<div>`, `<svg>`, and `<style>` tags.

**`dom-distill` is a zero-dependency, pure-TypeScript extraction engine.** You inject it directly into the browser context (e.g. via Playwright `page.evaluate`), and it runs a single, screaming-fast pass to convert the DOM into a minimal, semantic, structured JSON array containing *only* what an LLM needs to take action.

## What the LLM sees

If you feed `dom-distill` a typical noisy marketing page with a hero, hidden SVG blobs, and a footer newsletter form, the LLM doesn't see 800 lines of HTML. It sees this:

```json
[
  {
    "id": "dom-node-mmeytkdf-5",
    "text": "Acme Corp",
    "selector": "[data-testid=\"nav-home\"]",
    "rank": 6,
    "attributes": { "testId": "nav-home", "href": "/" }
  },
  {
    "id": "dom-node-mmeytkdf-6",
    "text": "Pricing",
    "selector": "[data-testid=\"nav-pricing\"]",
    "rank": 6,
    "attributes": { "testId": "nav-pricing", "href": "/pricing" }
  },
  {
    "id": "dom-node-mmeytkdf-12",
    "text": "Start free trial",
    "selector": "button[aria-label=\"Start free trial\"]",
    "rank": 3,
    "attributes": { "type": "button" }
  },
  {
    "id": "dom-node-mmeytkdf-21",
    "selector": "#email",
    "rank": 6,
    "attributes": { "name": "email", "placeholder": "you@example.com", "type": "email" }
  },
  {
    "id": "dom-node-mmeytkdf-22",
    "text": "Subscribe",
    "selector": "form#newsletter-form > button",
    "rank": 3,
    "attributes": { "type": "submit" }
  }
]
```
*Notice how deterministic CSS selectors are automatically generated so the LLM can easily reply with an action: `click("[data-testid=\"nav-pricing\"]")`.*

## Install

```bash
npm install dom-distill
```

## Quick start

```typescript
import { distill, filter, compress, diff } from 'dom-distill';

// 1. Distill the live DOM into a structured tree
const tree = distill(document.body, { maxDepth: 10, maxNodes: 500 });

// 2. Filter to high-value interactive elements
const nodes = filter(tree, { minRank: 2 });

// 3. Compress for LLM consumption
const payload = compress(tree);
// → JSON.stringify(payload) is ~98% smaller than raw DOM

// 4. Incremental updates via diffing
const nextNodes = filter(distill(document.body), { minRank: 2 });
const delta = diff(nodes, nextNodes);
// → Only send delta.changed + delta.appeared to the LLM
```

## API

### Distillation

| Function | Description |
|---|---|
| `distill(root?, config?)` | Synchronous single-pass DOM → tree |
| `distillAsync(root?, config?)` | Same, but via `requestIdleCallback` (non-blocking) |
| `metrics(tree)` | Aggregate stats: node count, depth, forms, nav elements |

### Filtering

| Function | Description |
|---|---|
| `filter(tree, config?)` | Keep only nodes with InteractionRank ≥ threshold |
| `filterAsync(tree, config?)` | Same, cooperatively scheduled |
| `calculateInteractionRank(node)` | Score a single node (0–10+) |

### Compression & Diffing

| Function | Description |
|---|---|
| `compress(tree)` | Strip runtime fields → JSON-serializable |
| `decompress(data)` | Reconstruct full tree from compressed data |
| `fingerprintNode(node)` | Stable hash for a single node |
| `fingerprintTree(nodes)` | Hash an entire node array |
| `diff(prev, next)` | Three-way delta: changed / appeared / disappeared |

### React Integration (optional, tree-shakeable)

| Function | Description |
|---|---|
| `enhanceTreeWithFiber(tree)` | Walk React Fiber tree for component names, props, patterns |
| `findReactComponents(tree, name?)` | Find components by name |
| `analyzeReactPatterns(tree)` | Count forms, modals, dropdowns, etc. |

## How it works

- **Single-pass construction** — One DFS walk builds the tree with selectors, semantic tags, visibility checks, and action type detection. No second pass.
- **InteractionRank scoring** — Each node gets a 0–10+ score based on tag semantics, ARIA roles, attributes, and visibility. Only high-value nodes survive filtering.
- **Cooperative scheduling** — `distillAsync` / `filterAsync` use `requestIdleCallback` with 5ms time budgets. The main thread never blocks, even on 10k-node DOMs.
- **Fingerprint-based diffing** — Stable node hashes enable three-way diffs (changed/appeared/disappeared) for incremental LLM updates instead of full-tree resends.
- **React Fiber integration** — Optional `enhanceTreeWithFiber()` walks the internal Fiber tree to extract component names, sanitized props, and structural patterns (forms, modals, portals). Fully tree-shakeable — doesn't ship if you don't import it.

## Benchmarks

Real-world test running `dom-distill` on the live DOM of popular sites:

| Site | Raw DOM Nodes | Raw Tokens (html) | Distill Time | Filtered Nodes | Filtered Tokens | Token Reduction |
|---|---|---|---|---|---|---|
| **GitHub Homepage** | ~1,800 | ~140k | ~50ms | 217 | ~8,800 | **93.7%** |
| **Stripe** | ~2,000 | ~156k | ~65ms | 206 | ~10k | **93.5%** |
| **React Docs** | ~1,800 | ~68k | ~65ms | 172 | ~7,500 | **88.9%** |
| **GitHub Repo** | ~2,000 | ~82k | ~40ms | 219 | ~9,300 | **88.7%** |
| **Wikipedia** | ~3,200 | ~54k | ~300ms | 1,006 | ~42k | **22.3%** (Link dense) |
| **Hacker News** | ~800 | ~8.6k | ~130ms | 227 | ~10k | **—** (Text dense) |

*Measured on Node.js using `jsdom` with `maxDepth: 30`, `maxNodes: 5000`.*

## Zero dependencies

No runtime dependencies. Pure TypeScript, browser APIs only. Ships ESM + CJS + full type declarations.

## License

MIT
