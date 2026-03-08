import React, { useState } from 'react';
import { GlobalSettings } from '../types';
import { X } from 'lucide-react';

export default function SettingsModal({
    settings,
    onSave,
    onClose
}: {
    settings: GlobalSettings,
    onSave: (s: GlobalSettings) => void,
    onClose: () => void
}) {
    const [draft, setDraft] = useState<GlobalSettings>({ ...settings });

    return (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-panel w-full max-w-sm rounded-[12px] p-6 shadow-2xl relative flex flex-col gap-4 min-h-0 max-h-full overflow-y-auto">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
                    <X className="w-5 h-5" />
                </button>

                <h2 className="text-lg font-medium text-white mb-2">Global Settings</h2>

                <div className="flex flex-col gap-1.5 focus-within:text-primary transition-colors">
                    <label className="text-xs text-gray-400 font-medium tracking-wide">API Key (OpenAI/Google/Anthropic)</label>
                    <input
                        type="password"
                        value={draft.apiKey}
                        onChange={e => setDraft(p => ({ ...p, apiKey: e.target.value }))}
                        className="bg-black/40 border border-glass-border rounded-md px-3 py-2 outline-none focus:border-primary text-sm font-mono placeholder:text-gray-600 transition-colors"
                        placeholder="sk-..."
                    />
                </div>

                <div className="flex flex-col gap-1.5 focus-within:text-primary transition-colors">
                    <label className="text-xs text-gray-400 font-medium tracking-wide">Model ID</label>
                    <input
                        type="text"
                        value={draft.model}
                        onChange={e => setDraft(p => ({ ...p, model: e.target.value }))}
                        className="bg-black/40 border border-glass-border rounded-md px-3 py-2 outline-none focus:border-primary text-sm font-mono transition-colors"
                        placeholder="google/gemini-2.5-flash"
                    />
                    <span className="text-[10px] text-gray-500">e.g., openai:gpt-4o, google:gemini-2.5-flash</span>
                </div>

                <div className="flex flex-col gap-1.5 focus-within:text-primary transition-colors">
                    <label className="text-xs text-gray-400 font-medium tracking-wide">Max Steps Limit</label>
                    <input
                        type="number"
                        value={draft.maxSteps}
                        onChange={e => setDraft(p => ({ ...p, maxSteps: parseInt(e.target.value) || 30 }))}
                        className="bg-black/40 border border-glass-border rounded-md px-3 py-2 outline-none focus:border-primary text-sm font-mono transition-colors"
                    />
                </div>

                <button
                    onClick={() => onSave(draft)}
                    className="primary-btn mt-4 py-2.5"
                >
                    Save Settings
                </button>
            </div>
        </div>
    );
}
