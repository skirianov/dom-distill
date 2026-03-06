import type { TaskConfig, TaskProgress } from './scheduler.types';

export type TaskPriority = 'immediate' | 'idle';

export interface InternalTask<T> {
  id: string;
  priority: TaskPriority;
  timeout?: number;
  generator: Generator<TaskProgress, T, void>;
  abortController: AbortController;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

let taskIdCounter = 0;

const IDLE_CHUNK_MS = 5;

const hasIdleCallback =
  typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function';

const requestIdle =
  hasIdleCallback
    ? (cb: IdleRequestCallback, options?: IdleRequestOptions) =>
      (window as any).requestIdleCallback(cb, options)
    : (cb: () => void) => window.setTimeout(cb, 0);

export const schedule = async <T>(
  config: TaskConfig,
  generatorFactory: () => Generator<TaskProgress, T, void>
): Promise<T> => {
  const abortController = new AbortController();
  const id = `task-${++taskIdCounter}`;

  return new Promise<T>((resolve, reject) => {
    const task: InternalTask<T> = {
      id,
      priority: config.priority,
      timeout: config.timeout,
      generator: generatorFactory(),
      abortController,
      resolve,
      reject
    };

    runTask(task).catch(reject);
  });
};

const runTask = async <T>(task: InternalTask<T>): Promise<void> => {
  if (task.priority === 'immediate') {
    try {
      const result = task.generator.next();
      if (result.done) {
        task.resolve(result.value);
      } else {
        // Exhaust the generator synchronously for immediate tasks.
        let last: IteratorResult<TaskProgress, T> = result;
        while (!last.done) {
          last = task.generator.next();
        }
        task.resolve((last as IteratorReturnResult<T>).value);
      }
    } catch (error) {
      task.reject(error as Error);
    }
    return;
  }

  const start = Date.now();

  const processChunk = () => {
    const startTime = performance.now();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = task.generator.next();

        if (done) {
          task.resolve(value);
          return;
        }

        if (performance.now() - startTime > IDLE_CHUNK_MS) {
          break;
        }
      }
    } catch (error) {
      task.reject(error as Error);
      return;
    }

    if (task.timeout && Date.now() - start > task.timeout) {
      task.reject(new Error('Task timed out'));
      return;
    }

    requestIdle(processChunk as any);
  };

  requestIdle(processChunk as any);
};

