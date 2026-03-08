import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

// Keep track of active agent loops by ID
const activeSessions = new Map<string, { isRunning: boolean; shouldStop: boolean; totalCost: number }>();

// Cache for OpenRouter prices
const modelPrices = new Map<string, { prompt: number, completion: number }>();

async function fetchOpenRouterPrices() {
    try {
        const res = await fetch('https://openrouter.ai/api/v1/models');
        if (!res.ok) return;
        const json = await res.json();
        for (const model of json.data) {
            if (model.pricing) {
                modelPrices.set(model.id, {
                    prompt: parseFloat(model.pricing.prompt) || 0,
                    completion: parseFloat(model.pricing.completion) || 0
                });
            }
        }
    } catch (e) {
        console.error('Failed to fetch prices', e);
    }
}

// Fetch prices initially
fetchOpenRouterPrices();

function setStatus(sessionId: string, isRunning: boolean) {
    const session = activeSessions.get(sessionId);
    if (session) {
        session.isRunning = isRunning;
        chrome.runtime.sendMessage({ type: 'AGENT_STATUS', sessionId, isRunning }).catch(() => { });
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_AGENT') {
        const { sessionId, tabId, task, chatHistory, settings } = msg;

        if (!activeSessions.has(sessionId)) {
            activeSessions.set(sessionId, { isRunning: false, shouldStop: false, totalCost: 0 });
        }

        const session = activeSessions.get(sessionId)!;
        if (session.isRunning) {
            sendLog(sessionId, 'System', 'Agent is already running in this session!', 'error');
            return;
        }

        session.shouldStop = false;
        runAgent(sessionId, tabId, task, chatHistory || [], settings);
    }
    else if (msg.type === 'STOP_AGENT') {
        const session = activeSessions.get(msg.sessionId);
        if (session && session.isRunning) {
            session.shouldStop = true;
            sendLog(msg.sessionId, 'System', 'Stopping agent loop...', 'system');
        }
    }
    else if (msg.type === 'GET_STATUS' && msg.sessionId) {
        const session = activeSessions.get(msg.sessionId);
        if (session) {
            chrome.runtime.sendMessage({ type: 'AGENT_STATUS', sessionId: msg.sessionId, isRunning: session.isRunning }).catch(() => { });
        }
    }
});

function sendLog(sessionId: string, sender: string, message: string, logType: 'system' | 'user-task' | 'action' | 'error' | 'answer' = 'action') {
    chrome.runtime.sendMessage({ type: 'AGENT_LOG', sessionId, message, logType, sender }).catch(() => { });
}

function sendStats(sessionId: string, stats: any) {
    chrome.runtime.sendMessage({ type: 'STATS_UPDATE', sessionId, stats }).catch(() => { });
}

function createClient(settings: any) {
    if (settings.model.startsWith('google:')) {
        const google = createGoogleGenerativeAI({ apiKey: settings.apiKey });
        return google(settings.model.replace('google:', ''));
    }
    // Default to openAI compatible (OpenRouter etc)
    const openai = createOpenAI({
        apiKey: settings.apiKey,
        baseURL: settings.baseUrl || 'https://api.openai.com/v1'
    });
    return openai(settings.model.replace('openai:', ''));
}

async function askLLM(task: string, chatHistory: any[], pageUrl: string, pageTitle: string, nodes: any[], previousActions: string[], scrollPosition: string, settings: any) {
    const model = createClient(settings);

    let historyStr = chatHistory.length > 0
        ? '\nChat History:\n' + chatHistory.map((msg: any) => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n')
        : '';

    const userPrompt = `Task: ${task}
${historyStr}

Page: ${pageUrl}
Title: ${pageTitle}
Scroll: ${scrollPosition}

Previous actions in current task:
${previousActions.length > 0 ? previousActions.map((a, i) => `${i + 1}. ${a}`).join('\n') : '(none)'}

Interactive elements (${nodes.length} nodes):
${JSON.stringify(nodes, null, 2)}`;

    const { object, usage } = await generateObject({
        model,
        schema: z.object({
            thoughtProcess: z.string().describe('Explain your reasoning for this action, reflecting on any past failures before deciding.'),
            type: z.enum(['click', 'type', 'type_and_submit', 'scroll', 'press_key', 'navigate', 'extract', 'wait', 'answer', 'done']),
            selector: z.string().optional().describe('CSS selector for click, type, or type_and_submit'),
            elementText: z.string().optional().describe('The EXACT text of the element you want to click. Required if clicking a link or button, to ensure the correct element is hit.'),
            text: z.string().optional().describe('Text to type'),
            direction: z.enum(['up', 'down']).optional().describe('Scroll direction'),
            key: z.string().optional().describe('Key to press (e.g. Enter)'),
            url: z.string().optional().describe('URL to navigate to'),
            description: z.string().optional().describe('Description of what to extract'),
            seconds: z.number().optional().describe('Seconds to wait'),
            message: z.string().optional().describe('A conversational answer to the user'),
            summary: z.string().optional().describe('Task summary or extracted data when done')
        }),
        system: `You are a browser automation agent and helpful assistant. Respond with the next action to accomplish the user's task.
Rules:
- Think step-by-step in your thoughtProcess field before acting. Acknowledge what happened in the previous step and whether it was successful.
- ONLY use selectors from the provided elements list. NEVER invent selectors.
- If a selector is completely identical to another element (e.g. "div > a"), you MUST also provide the exact 'elementText' of your target node to avoid mis-clicks.
- Use "done" when the user's request has been fully completed. Provide a "summary" of what was achieved. If the task involved finding a specific page or item, INCLUDE the relevant URL in the summary.
- Use "answer" to directly answer the user's question or provide a status update. This ends the current task execution. ALWAYS include relevant URLs from the page if the user is looking for specific information or results.
- If an action (like clicking "Post") causes a modal to close or a page to change, check if the task is complete before assuming failure.
- Use "navigate" for going to google.com or general URLs if needed initially or during task
- Use "scroll" when the content you need might be below the visible area
- Use "extract" to read data from the page to gather context
- Use "type" for live-filter inputs. Use "type_and_submit" for search forms (Google, Wikipedia)
- If a previous action FAILED, try a DIFFERENT approach. Reflect on why it failed in thoughtProcess`,
        prompt: userPrompt,
        temperature: 0
    });

    return { action: object, usage };
}

async function runAgent(sessionId: string, tabId: number, task: string, chatHistory: any[], settings: any) {
    setStatus(sessionId, true);
    sendLog(sessionId, 'User', task, 'user-task');

    let totalRawTokens = 0;
    let totalDistilledTokens = 0;
    let previousActions: string[] = [];
    let consecutiveFailures = 0;
    let lastActionStr = '';

    const session = activeSessions.get(sessionId)!;

    try {
        for (let step = 1; step <= settings.maxSteps; step++) {
            if (session.shouldStop) {
                sendLog(sessionId, 'System', 'Agent stopped by user.', 'system');
                break;
            }

            sendLog(sessionId, 'System', `Step ${step}`, 'system');

            // 1. Ensure target tab exists
            let targetTab;
            try {
                targetTab = await chrome.tabs.get(tabId);
            } catch (e) {
                throw new Error('Tab closed or unavailable.');
            }

            // Ensure content script is injected
            if (!targetTab.url?.startsWith('chrome://')) {
                await chrome.scripting.executeScript({
                    target: { tabId: targetTab.id! },
                    files: ['content.js']
                }).catch((e) => {
                    console.warn('Injection failed:', e);
                });
            }

            // Distill the page
            let distillResult: any = null;
            if (targetTab.url?.startsWith('chrome://')) {
                distillResult = { nodes: [], rawTokens: 0, distilledTokens: 0, rawNodes: 0, pageTitle: targetTab.title || '', scrollPosition: '0%' };
            } else {
                try {
                    const response = await chrome.tabs.sendMessage(targetTab.id!, { type: 'DISTILL' });
                    if (!response || !response.success) throw new Error(response?.error || 'Empty response');
                    distillResult = response.data;
                } catch (err: any) {
                    sendLog(sessionId, 'System', `Waiting for page load...`, 'system');
                    await new Promise(r => setTimeout(r, 2000));
                    try {
                        await chrome.scripting.executeScript({ target: { tabId: targetTab.id! }, files: ['content.js'] });
                        const response = await chrome.tabs.sendMessage(targetTab.id!, { type: 'DISTILL' });
                        if (response && response.success) distillResult = response.data;
                        else distillResult = { nodes: [], rawTokens: 0, distilledTokens: 0, rawNodes: 0, pageTitle: targetTab.title || '', scrollPosition: '0%' };
                    } catch (e) {
                        distillResult = { nodes: [], rawTokens: 0, distilledTokens: 0, rawNodes: 0, pageTitle: targetTab.title || '', scrollPosition: '0%' };
                    }
                }
            }

            const { nodes, rawTokens, distilledTokens, pageTitle, scrollPosition } = distillResult;

            totalRawTokens += rawTokens;
            totalDistilledTokens += distilledTokens;

            const saved = totalRawTokens - totalDistilledTokens;
            const pct = totalRawTokens > 0 ? ((saved / totalRawTokens) * 100).toFixed(1) : '0.0';
            sendStats(sessionId, { totalSaved: saved, totalDistilled: totalDistilledTokens, savingsPct: pct });

            sendLog(sessionId, 'System', `Page distilled: ${nodes.length} interactive elements.`, 'system');

            if (session.shouldStop) break;

            // Ask LLM
            let action;
            let usage;
            try {
                const llmRes = await askLLM(task, chatHistory, targetTab.url || '', pageTitle, nodes, previousActions, scrollPosition, settings);
                action = llmRes.action;
                usage = llmRes.usage;

                // Calculate cost
                if (usage) {
                    const modelNameId = settings.model.replace('openai:', '').replace('google:', '');
                    const prices = modelPrices.get(modelNameId);
                    if (prices) {
                        const { promptTokens, completionTokens } = usage as any;
                        const stepCost = (promptTokens * prices.prompt) + (completionTokens * prices.completion);
                        session.totalCost += stepCost;
                        sendStats(sessionId, { totalCost: session.totalCost });
                    }
                }
            } catch (err: any) {
                throw new Error(`LLM Error: ${err.message}`);
            }

            // Loop detection ignoring thoughtProcess
            const actionWithoutThought: any = { ...action };
            delete actionWithoutThought.thoughtProcess;
            const actionStr = JSON.stringify(actionWithoutThought);

            sendLog(sessionId, 'Agent', `[Thought]: ${action.thoughtProcess}\n\n[Action Request]: ${actionStr}`, 'action');

            if (actionStr === lastActionStr) {
                throw new Error('Loop detected: same action repeated.');
            }
            lastActionStr = actionStr;

            // Execute action
            if (action.type === 'navigate') {
                if (action.url) {
                    await chrome.tabs.update(targetTab.id!, { url: action.url });
                    await new Promise(r => setTimeout(r, 3000)); // wait for navigation
                    previousActions.push(`Navigated to ${action.url}`);
                }
                consecutiveFailures = 0;
            } else if (action.type === 'answer') {
                sendLog(sessionId, 'Agent', action.message || '', 'answer');
                previousActions.push(`Agent answered: ${action.message}`);
                consecutiveFailures = 0;
                break;
            } else if (action.type === 'done') {
                sendLog(sessionId, 'System', `Done: ${action.summary}`, 'system');
                break;
            } else {
                if (targetTab.url?.startsWith('chrome://')) {
                    throw new Error('Cannot execute scripts on chrome:// pages. You should navigate to a web page.');
                }

                try {
                    const res = await chrome.tabs.sendMessage(targetTab.id!, { type: 'EXECUTE', action });
                    if (!res || !res.success) throw new Error(res?.error || 'Execution failed');
                    previousActions.push(res.result);
                    sendLog(sessionId, 'System', res.result, 'system');
                    consecutiveFailures = 0;
                } catch (err: any) {
                    const isBFCacheError = err.message.includes('back/forward cache') || err.message.includes('message channel closed');
                    const isNavAction = action.type === 'click' || action.type === 'type_and_submit' || action.type === 'press_key';

                    if (isBFCacheError && isNavAction) {
                        const msg = `Action triggered navigation (channel closed by bfcache)`;
                        previousActions.push(msg);
                        sendLog(sessionId, 'System', msg, 'system');
                        consecutiveFailures = 0;
                    } else {
                        sendLog(sessionId, 'System', `Action failed: ${err.message}`, 'error');
                        previousActions.push(`FAILED: ${err.message}`);
                        consecutiveFailures++;
                        if (consecutiveFailures >= 3) {
                            throw new Error(`3 consecutive failures. Stopping.`);
                        }
                    }
                }
            }
        }
    } catch (err: any) {
        sendLog(sessionId, 'System', `Task stopped: ${err.message}`, 'error');
    } finally {
        setStatus(sessionId, false);
        sendLog(sessionId, 'System', `Agent run finished.`, 'system');
    }
}
