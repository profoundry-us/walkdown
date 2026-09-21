/*
 * A picture on a message (n-0096).
 *
 * Some feedback is a picture: this overlaps, this is cut off, this is the
 * wrong shade. The bytes live under the threads directory, in
 * `attachments/`, beside the records that name them - one of the three
 * places the review server may write (ownership.writes), and the place a
 * moved ledger takes with it. A message records `attachments: [{ file,
 * name }]`, where `file` is relative to the threads directory, so the
 * record never names a disk.
 *
 * Pictures only, and small ones: a thread is a conversation, not a drive.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ATTACHMENT_DIR = 'attachments';
export const ATTACHMENT_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
});
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 4;

/**
 * What a door was handed, checked: a list of `{ name, type, data }` with the
 * bytes base64. Refuses in words, before anything is written.
 * @returns {{ name: string, ext: string, bytes: Buffer }[]}
 */
export function acceptAttachments(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments is a list');
  if (raw.length > ATTACHMENT_MAX_COUNT)
    throw new Error(`at most ${ATTACHMENT_MAX_COUNT} pictures on one message`);
  return raw.map((a, i) => {
    const ext = ATTACHMENT_TYPES[a?.type];
    if (!ext)
      throw new Error(`attachment ${i + 1}: a picture (${Object.keys(ATTACHMENT_TYPES).join(', ')}), not ${a?.type ?? 'nothing'}`);
    if (typeof a.data !== 'string' || !a.data) throw new Error(`attachment ${i + 1}: no bytes`);
    const bytes = Buffer.from(a.data.replace(/^data:[^,]*,/, ''), 'base64');
    if (!bytes.length) throw new Error(`attachment ${i + 1}: no bytes`);
    if (bytes.length > ATTACHMENT_MAX_BYTES)
      throw new Error(`attachment ${i + 1}: ${(bytes.length / 1048576).toFixed(1)}MB - a picture on a message is under ${ATTACHMENT_MAX_BYTES / 1048576}MB`);
    const name = String(a.name ?? `picture.${ext}`).replace(/[^\w. -]+/g, '_').slice(0, 80) || `picture.${ext}`;
    return { name, ext, bytes };
  });
}

/**
 * Write the pictures beside the thread they belong to, numbered after the
 * ones already there, and answer with what the message records.
 * @returns {{ file: string, name: string }[]}
 */
export function writeAttachments(threadsDir, id, accepted) {
  if (!accepted.length) return [];
  const dir = join(threadsDir, ATTACHMENT_DIR);
  mkdirSync(dir, { recursive: true });
  let n = readdirSync(dir).filter((f) => f.startsWith(`${id}-`)).length;
  return accepted.map(({ name, ext, bytes }) => {
    let file;
    for (;;) {
      file = `${id}-${++n}.${ext}`;
      if (!existsSync(join(dir, file))) break;
    }
    writeFileSync(join(dir, file), bytes, { flag: 'wx' });
    return { file: `${ATTACHMENT_DIR}/${file}`, name };
  });
}

/** A served path is a bare picture name under attachments/, nothing else. */
export const attachmentFile = (rel) => {
  const m = /^attachments\/([\w.-]+\.(png|jpg|gif|webp))$/.exec(rel ?? '');
  return m ? m[1] : null;
};
