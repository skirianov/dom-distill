export interface TaskConfig {
  priority: 'immediate' | 'idle';
  timeout?: number;
  signal?: AbortSignal;
}

export interface TaskProgress {
  type: 'progress';
  processed: number;
  total?: number;
}

