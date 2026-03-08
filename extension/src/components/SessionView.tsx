import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Play, ShieldAlert, BadgeCheck } from 'lucide-react';
import { SessionState, GlobalSettings } from '../types';

export default function SessionView({ session, settings }: { session: SessionState, settings: GlobalSettings }) {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [session.logs]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || session.isRunning) return;

        if (!settings.apiKey) {
            alert("Please set your API key in settings first.");
            return;
        }

        const chatHistory = session.logs
            .map(l => {
                if (l.logType === 'user-task') return { role: 'user', content: l.message };
                if (l.logType === 'answer') return { role: 'assistant', content: l.message };
                if (l.logType === 'action') return { role: 'assistant', content: `[Action Executed]: ${l.message}` };
                if (l.logType === 'system' && !l.message.startsWith('Task') && !l.message.startsWith('Step') && !l.message.startsWith('Page')) return { role: 'system', content: `[System Feed]: ${l.message}` };
                return null;
            })
            .filter(Boolean);

        if (chrome?.runtime) {
            chrome.runtime.sendMessage({
                type: 'START_AGENT',
                sessionId: session.id,
                tabId: session.tabId,
                task: input.trim(),
                chatHistory,
                settings
            });
        }
        setInput('');
    };

    const handleStop = () => {
        if (chrome?.runtime && session.isRunning) {
            chrome.runtime.sendMessage({ type: 'STOP_AGENT', sessionId: session.id });
        }
    };

    const renderMessageWithLinks = (text: string) => {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = text.split(urlRegex);
        return parts.map((part, i) => {
            if (part.match(urlRegex)) {
                return (
                    <a
                        key={i}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline break-all cursor-pointer"
                    >
                        {part}
                    </a>
                );
            }
            return part;
        });
    };

    return (
        <div className="flex flex-col h-full w-full">
            {/* Session Header / Stats */}
            <div className="flex bg-black/40 border-b border-glass-border px-4 py-2 text-xs items-center justify-between shrink-0">
                <div className="flex gap-4">
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">Tokens Saved</span>
                        <span className="font-mono text-accent font-medium">{session.stats.savingsPct}%</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">Distilled</span>
                        <span className="font-mono text-gray-300 font-medium">{session.stats.totalDistilled}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">Cost</span>
                        <span className="font-mono text-blue-300 font-medium">${(session.stats.totalCost || 0).toFixed(4)}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/40 border border-white/5">
                    <div className={`w-2 h-2 rounded-full ${session.isRunning ? 'bg-accent animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-gray-500'}`} />
                    <span className="text-gray-300 font-medium font-mono tracking-wide">{session.isRunning ? 'ACTIVE' : 'IDLE'}</span>
                </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {session.logs.map((log) => (
                    <div
                        key={log.id}
                        className={`
              log-entry
              ${log.logType === 'system' ? 'log-entry-system' : ''}
              ${log.logType === 'action' ? 'log-entry-action' : ''}
              ${log.logType === 'user-task' ? 'log-entry-user self-end ml-8 !bg-primary/10' : ''}
              ${log.logType === 'answer' ? 'log-entry-user self-start mr-8 !bg-blue-500/20 border-blue-500/30 text-white' : ''}
              ${log.logType === 'error' ? 'log-entry-error' : ''}
            `}
                    >
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between opacity-60 text-[10px] uppercase font-bold tracking-wider mb-1">
                                <span>{log.sender}</span>
                                <span>
                                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                            </div>
                            <div className={`leading-relaxed ${log.logType === 'action' ? 'text-gray-300' : 'text-gray-100'} ${log.logType === 'answer' ? 'text-lg font-medium' : ''}`}>
                                {renderMessageWithLinks(log.message)}
                            </div>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-glass border-t border-glass-border shrink-0">
                <form onSubmit={handleSubmit} className="flex gap-2 items-end">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={session.isRunning}
                        placeholder={session.isRunning ? "Agent is running..." : "What should I do on this page?"}
                        className="flex-1 bg-black/40 border border-glass-border rounded-lg text-white p-3 font-sans resize-none outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        rows={2}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e);
                            }
                        }}
                    />
                    <div className="flex items-center justify-center shrink-0">
                        {session.isRunning && !session.shouldStop ? (
                            <button
                                type="button"
                                onClick={handleStop}
                                className="stop-btn"
                                title="Stop Agent"
                            >
                                <Square className="w-4 h-4 fill-current" />
                            </button>
                        ) : session.isRunning && session.shouldStop ? (
                            <button
                                type="button"
                                disabled
                                className="stop-btn opacity-50"
                                title="Stopping..."
                            >
                                <Square className="w-4 h-4 fill-current animate-spin" />
                            </button>
                        ) : (
                            <button
                                type="submit"
                                disabled={!input.trim()}
                                className="run-btn"
                                title="Run Agent"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
}
