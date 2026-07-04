// Incremental live tail of transcript .jsonl files. Fully implemented in M3;
// M1 only needs the change hook to exist so the watcher can call it.

type ChangeListener = (file: string) => void;
const listeners = new Set<ChangeListener>();

export function onTranscriptFileChanged(file: string) {
  for (const l of listeners) l(file);
}

export function addTranscriptChangeListener(l: ChangeListener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
