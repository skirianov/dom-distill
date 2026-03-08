export type ActionLog = {
    id: string;
    sender: 'Agent' | 'User' | 'System' | 'Error';
    message: string;
    logType: 'system' | 'user-task' | 'action' | 'error' | 'answer';
    timestamp: Date;
};

export type SessionState = {
    id: string; // usually tied to a tabId
    tabId: number;
    url: string;
    title: string;
    createdAt: number;
    isRunning: boolean;
    shouldStop: boolean;
    logs: ActionLog[];
    stats: {
        totalDistilled: number;
        totalSaved: number;
        savingsPct: string;
        totalCost: number;
    };
};

export type GlobalSettings = {
    apiKey: string;
    model: string;
    maxSteps: number;
};

export const DEFAULT_SETTINGS: GlobalSettings = {
    apiKey: '',
    model: 'google/gemini-2.5-flash',
    maxSteps: 30
};
