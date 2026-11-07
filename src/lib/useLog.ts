import { useCallback, useState } from 'react';
import type { LogLine } from '@/components/ui';
import { formatClock } from './time';

/** In-memory log, newest first. Tone is guessed from the message text. */
export function useLog(max = 100) {
  const [lines, setLines] = useState<LogLine[]>([]);

  const add = useCallback(
    (msg: string) => {
      const tone: LogLine['tone'] = /^warning/i.test(msg)
        ? 'warn'
        : /failed|invalid|denied|error|not granted/i.test(msg)
          ? 'danger'
          : 'normal';
      setLines((l) => [{ time: formatClock(new Date()), msg, tone }, ...l].slice(0, max));
    },
    [max],
  );

  const clear = useCallback(() => setLines([]), []);
  return { lines, add, clear };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
