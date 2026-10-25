// Node-side file handling for 3D checkpoints (format: src/lab/core/checkpoint3d.ts). Kept outside src/ because the
// application bundle must not depend on node:fs.
//
// writeCheckpointAtomic: write <path>.tmp, fsync it, rename it over <path> (atomic on POSIX), fsync the directory.
// If the process dies or the write fails at any point before the rename, <path> still holds the previous complete
// checkpoint; a leftover <path>.tmp is never read.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AtomicWriteOptions {
  /** bytes per write call (default 16 MiB) */
  chunkBytes?: number;
  /** test hooks simulating a crash: called after each chunk that leaves the file incomplete, and before the rename */
  afterPartialWrite?: (written: number) => void;
  beforeRename?: () => void;
}

export function writeCheckpointAtomic(path: string, bytes: Uint8Array, o: AtomicWriteOptions = {}) {
  const tmp = `${path}.tmp`;
  const chunk = o.chunkBytes ?? 1 << 24;
  const fd = openSync(tmp, 'w');
  try {
    let off = 0;
    while (off < bytes.length) {
      off += writeSync(fd, bytes, off, Math.min(chunk, bytes.length - off));
      if (off < bytes.length) o.afterPartialWrite?.(off);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  o.beforeRename?.();
  renameSync(tmp, path);
  const dfd = openSync(dirname(path), 'r');
  try {
    fsyncSync(dfd);
  } finally {
    closeSync(dfd);
  }
}

export function readCheckpointFile(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
