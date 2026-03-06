import { describe, it, expect } from 'vitest';
import { schedule } from '../src/scheduler';

describe('schedule', () => {
  it('accepts immediate tasks (smoke test)', async () => {
    const result = await schedule(
      { priority: 'immediate' },
      function* () {
        return 'ok';
      }
    );
    expect(result).toBe('ok');
  });

  it('runs tasks via generator chunks', async () => {
    const result = await schedule(
      { priority: 'immediate' },
      function* () {
        let count = 0;
        yield { type: 'progress', processed: 1, total: 2 };
        count++;
        yield { type: 'progress', processed: 2, total: 2 };
        count++;
        return count;
      }
    );
    expect(result).toBe(2);
  });

  it('handles idle tasks without error', async () => {
    const result = await schedule(
      { priority: 'idle' },
      function* () {
        return 'idle-ok';
      }
    );
    expect(result).toBe('idle-ok');
  });

  it('rejects if generator throws', async () => {
    await expect(
      schedule(
        { priority: 'immediate' },
        function* () {
          throw new Error('generator error');
        }
      )
    ).rejects.toThrow('generator error');
  });

  it('times out if takes too long in idle mode', async () => {
    await expect(
      schedule(
        { priority: 'idle', timeout: 1 }, // 1ms timeout
        function* () {
          const start = Date.now();
          while (Date.now() - start < 10) {
            // Busy wait to simulate slow work
            // wait actually we yield to allow time to pass
            yield { type: 'progress', processed: 1, total: 1 };
          }
          return 'done';
        }
      )
    ).rejects.toThrow('Task timed out');
  });
});
