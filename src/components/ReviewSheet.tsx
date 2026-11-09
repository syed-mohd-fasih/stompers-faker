// "Preview before you change anything": a bottom sheet listing exactly what a ChangeSet
// will insert/delete, with before → after totals. Any screen calls
//   const ok = await review(changeSet)
// and only applies when the user confirmed.

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ownAfter, type ChangeSet } from '@/lib/changes';
import { formatInput, formatNumber, formatTime } from '@/lib/time';
import { Button, Sheet, TextButton } from './ui';

type Review = (cs: ChangeSet, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>;

const Ctx = createContext<Review | null>(null);

const MAX_ROWS = 40;

const when = (start: number, end: number) => {
  const s = new Date(start);
  const sameDay = new Date(end).toDateString() === s.toDateString();
  return `${formatInput(s)}${sameDay ? '' : ' →'}–${formatTime(new Date(end))}`;
};

function Row({ sign, start, end, count, label }: { sign: '+' | '−'; start: number; end: number; count: number; label?: string }) {
  return (
    <View className="flex-row items-center gap-3 border-t border-line py-2">
      <Text className={`w-4 font-mono text-[15px] ${sign === '+' ? 'text-ok' : 'text-danger'}`}>{sign}</Text>
      <Text className="flex-1 font-mono text-[13px] text-fg-muted">{when(start, end)}</Text>
      {label ? <Text className="font-sans text-[12px] text-fg-muted">{label}</Text> : null}
      <Text className="font-sans-semibold text-[14px] text-fg">{formatNumber(count)}</Text>
    </View>
  );
}

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ cs: ChangeSet; confirmLabel: string; danger: boolean } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const review = useCallback<Review>((cs, opts) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState({ cs, confirmLabel: opts?.confirmLabel ?? 'Apply', danger: opts?.danger ?? cs.deletes.length > 0 });
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setState(null);
  };

  const cs = state?.cs;
  const nothing = cs && cs.kind !== 'snapshot' && cs.inserts.length === 0 && cs.deletes.length === 0;
  const rows = cs
    ? [
        ...cs.deletes.map((r) => ({ sign: '−' as const, ...r, label: r.kind })),
        ...cs.inserts.map((r) => ({ sign: '+' as const, ...r, label: undefined })),
        ...(cs.snapshot?.records ?? []).map((r) => ({ sign: '+' as const, ...r, label: 'saved' })),
      ].sort((a, b) => a.start - b.start)
    : [];

  return (
    <Ctx.Provider value={review}>
      {children}
      <Sheet visible={state !== null} onClose={() => close(false)}>
        {cs ? (
          <>
            <Text className="font-display text-[24px] text-fg">{cs.title}</Text>
            <View className="flex-row flex-wrap gap-x-5 gap-y-1">
              {cs.kind === 'snapshot' ? (
                <Text className="font-sans text-[15px] text-fg-muted">
                  Saves {rows.length} record{rows.length === 1 ? '' : 's'} ({formatNumber(cs.ownBefore)} steps). Health data is not changed.
                </Text>
              ) : (
                <>
                  <Text className="font-sans-semibold text-[15px] text-danger">−{cs.deletes.length} records</Text>
                  <Text className="font-sans-semibold text-[15px] text-ok">+{cs.inserts.length} records</Text>
                  <Text className="font-sans text-[15px] text-fg-muted">
                    This app’s steps: {formatNumber(cs.ownBefore)} → {formatNumber(ownAfter(cs))}
                  </Text>
                </>
              )}
            </View>
            {nothing ? (
              <Text className="font-sans text-[15px] text-fg-muted">Nothing to change — already in that state.</Text>
            ) : (
              <ScrollView className="max-h-72">
                {rows.slice(0, MAX_ROWS).map((r, i) => (
                  <Row key={i} sign={r.sign} start={r.start} end={r.end} count={r.count} label={r.label} />
                ))}
                {rows.length > MAX_ROWS ? (
                  <Text className="border-t border-line py-2 font-sans text-[13px] text-fg-muted">…and {rows.length - MAX_ROWS} more</Text>
                ) : null}
              </ScrollView>
            )}
            {cs.deletes.length > 0 && cs.kind !== 'delete' ? (
              <Text className="font-sans text-[13px] text-fg-muted">An automatic snapshot is taken first, so this can be undone.</Text>
            ) : null}
            <Button label={state!.confirmLabel} onPress={() => close(true)} disabled={!!nothing} variant={state!.danger ? 'danger' : 'primary'} />
            <TextButton label="Cancel" tone="muted" onPress={() => close(false)} />
          </>
        ) : null}
      </Sheet>
    </Ctx.Provider>
  );
}

export function useReview(): Review {
  const r = useContext(Ctx);
  if (!r) throw new Error('useReview must be used inside ReviewProvider');
  return r;
}
