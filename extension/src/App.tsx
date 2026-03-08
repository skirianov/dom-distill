import React, { useState, useEffect } from 'react';
import { Settings, Sparkles, Plus, Trash2, StopCircle, PlayCircle } from 'lucide-react';
import { SessionState, GlobalSettings, DEFAULT_SETTINGS } from './types.ts';
import SessionView from './components/SessionView.tsx';
import SettingsModal from './components/SettingsModal.tsx';

export default function App() {
    const [settings, setSettings] = useState<GlobalSettings>(DEFAULT_SETTINGS);
    const [sessions, setSessions] = useState<SessionState[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    // Initial load
    useEffect(() => {
        if (chrome?.storage?.local) {
            chrome.storage.local.get(['agentSettings', 'agentSessions'], (res) => {
                if (res.agentSettings) setSettings({ ...DEFAULT_SETTINGS, ...res.agentSettings });
                if (res.agentSessions && Array.isArray(res.agentSessions)) {
                    setSessions(res.agentSessions);
                    if (res.agentSessions.length > 0) {
                        setActiveSessionId(res.agentSessions[0].id);
                    }
                }
            });
        }
    }, []);

    // Sync sessions on change
    useEffect(() => {
        if (chrome?.storage?.local && sessions.length > 0) {
            chrome.storage.local.set({ agentSessions: sessions });
        }
    }, [sessions]);

    // Listen for updates from Background
    useEffect(() => {
        if (!chrome?.runtime?.onMessage) return;

        const listener = (msg: any) => {
            if (!msg.sessionId) return; // ignore legacy or corrupted messages

            setSessions(prev => prev.map(s => {
                if (s.id !== msg.sessionId) return s;

                const next = { ...s };
                if (msg.type === 'AGENT_LOG') {
                    next.logs = [...s.logs, {
                        id: Math.random().toString(36).substr(2, 9),
                        sender: msg.sender,
                        message: msg.message,
                        logType: msg.logType,
                        timestamp: new Date()
                    }];
                } else if (msg.type === 'STATS_UPDATE') {
                    next.stats = { ...next.stats, ...msg.stats };
                } else if (msg.type === 'AGENT_STATUS') {
                    next.isRunning = msg.isRunning;
                    if (!msg.isRunning) next.shouldStop = false;
                }
                return next;
            }));
        };

        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    const createNewSession = async () => {
        // Attempt to bind to current tab
        let boundTabId = -1;
        let url = 'Unknown URL';
        let title = 'New Session';

        if (chrome?.tabs) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                boundTabId = tab.id;
                url = tab.url || url;
                title = tab.title || title;
            }
        }

        const newSession: SessionState = {
            id: `session_${Date.now()}`,
            tabId: boundTabId,
            url,
            title,
            createdAt: Date.now(),
            isRunning: false,
            shouldStop: false,
            logs: [{
                id: 'start-log',
                sender: 'System',
                message: 'Ready for a new task on this tab.',
                logType: 'system',
                timestamp: new Date()
            }],
            stats: { totalDistilled: 0, totalSaved: 0, savingsPct: '0%', totalCost: 0 }
        };

        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
    };

    const deleteSession = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setSessions(prev => prev.filter(s => s.id !== id));
        if (activeSessionId === id) {
            setActiveSessionId(null);
        }
    };

    const activeSession = sessions.find(s => s.id === activeSessionId);

    return (
        <div className="flex flex-col h-full w-full relative">
            <header className="flex justify-between items-center p-4 glass-panel border-b-0 z-10 shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h1 className="text-lg font-semibold bg-gradient-to-r from-blue-300 to-indigo-500 bg-clip-text text-transparent">
                        Distill Agent
                    </h1>
                </div>
                <button
                    onClick={() => setShowSettings(true)}
                    className="text-gray-400 hover:text-white transition-colors"
                    title="Settings"
                >
                    <Settings className="w-5 h-5" />
                </button>
            </header>

            {/* Main Content Area */}
            <div className="flex flex-1 overflow-hidden h-full">
                {/* Sidebar */}
                <aside className="w-16 sm:w-64 shrink-0 glass-panel border-r border-t-0 flex flex-col pt-2 transition-all">
                    <div className="px-2 pb-4">
                        <button
                            onClick={createNewSession}
                            className="w-full flex items-center justify-center sm:justify-start gap-2 primary-btn !py-2 !px-2 shadow-none"
                            title="New Session"
                        >
                            <Plus className="w-4 h-4" />
                            <span className="hidden sm:inline text-sm font-medium">New Session</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto w-full px-2 space-y-1">
                        {sessions.map(s => (
                            <div
                                key={s.id}
                                onClick={() => setActiveSessionId(s.id)}
                                className={`w-full text-left p-2 rounded-md cursor-pointer flex justify-between items-center group transition-colors overflow-hidden ${s.id === activeSessionId ? 'bg-primary/20 border border-primary/30' : 'hover:bg-white/5 border border-transparent'
                                    }`}
                                title={s.title}
                            >
                                <div className="truncate flex-1 min-w-0 pr-2">
                                    <div className="text-sm font-medium truncate hidden sm:block text-gray-200">{s.title}</div>
                                    <div className="text-xs text-gray-500 truncate hidden sm:block">{s.url}</div>
                                    {/* Reduced responsive icon */}
                                    {s.isRunning ?
                                        <PlayCircle className="w-5 h-5 sm:hidden mx-auto text-primary animate-pulse" /> :
                                        <Sparkles className="w-5 h-5 sm:hidden mx-auto text-gray-500" />
                                    }
                                </div>
                                <button
                                    onClick={(e) => deleteSession(e, s.id)}
                                    className="text-red-400/0 group-hover:text-red-400/80 hover:!text-red-400 p-1 rounded-sm hover:bg-red-400/20 transition-all hidden sm:block shrink-0"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                        {sessions.length === 0 && (
                            <div className="text-xs text-center text-gray-500 mt-4 hidden sm:block">No active sessions.</div>
                        )}
                    </div>
                </aside>

                {/* Chat / View Area */}
                <main className="flex-1 overflow-hidden flex flex-col bg-black/20">
                    {activeSession ? (
                        <SessionView
                            session={activeSession}
                            settings={settings}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-500 flex-col gap-4">
                            <Sparkles className="w-12 h-12 opacity-20" />
                            <p>Select or create a new session to begin.</p>
                        </div>
                    )}
                </main>
            </div>

            {showSettings && (
                <SettingsModal
                    settings={settings}
                    onSave={(newSet) => {
                        setSettings(newSet);
                        if (chrome?.storage?.local) chrome.storage.local.set({ agentSettings: newSet });
                        setShowSettings(false);
                    }}
                    onClose={() => setShowSettings(false)}
                />
            )}
        </div>
    );
}
