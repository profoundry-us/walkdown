/*
 * A picture on a message (n-0096): the door takes base64 pictures, writes
 * them under the threads directory beside the records, names them on the
 * message, and refuses anything that is not a small picture before writing
 * a byte.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { acceptAttachments, attachmentFile, writeAttachments } from '../lib/attachments.js';

const root = mkdtempSync(join(tmpdir(), 'wd-attach-'));
after(() => rmSync(root, { recursive: true, force: true }));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

test('pictures are accepted, written beside the threads and named on the message @rule:embed.threads.picture-on-a-pin', () => {
  const ok = acceptAttachments([{ name: 'after.png', type: 'image/png', data: `data:image/png;base64,${PNG}` }]);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].ext, 'png');
  const named = writeAttachments(root, 'n-0007', ok);
  assert.deepEqual(named, [{ file: 'attachments/n-0007-1.png', name: 'after.png' }]);
  assert.ok(existsSync(join(root, 'attachments', 'n-0007-1.png')));
  // A second on the same thread numbers on, whoever wrote the first.
  assert.deepEqual(writeAttachments(root, 'n-0007', ok).map((a) => a.file), ['attachments/n-0007-2.png']);
  assert.deepEqual(readdirSync(root), ['attachments'], 'nothing else appears under the threads directory');
});

test('not a picture, no bytes, too big, too many: refused in words, nothing written @rule:embed.threads.picture-on-a-pin', () => {
  assert.throws(() => acceptAttachments([{ name: 'x.pdf', type: 'application/pdf', data: PNG }]), /a picture/);
  assert.throws(() => acceptAttachments([{ name: 'x.png', type: 'image/png', data: '' }]), /no bytes/);
  assert.throws(() => acceptAttachments([{ name: 'x.png', type: 'image/png', data: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }]), /under 5MB/);
  assert.throws(() => acceptAttachments(Array.from({ length: 5 }, () => ({ type: 'image/png', data: PNG }))), /at most 4/);
  assert.throws(() => acceptAttachments('x.png'), /a list/);
  assert.deepEqual(acceptAttachments(null), []);
});

test('only a bare picture name under attachments/ is served @rule:embed.threads.picture-on-a-pin', () => {
  assert.equal(attachmentFile('attachments/n-0007-1.png'), 'n-0007-1.png');
  assert.equal(attachmentFile('attachments/../n-0007.yml'), null);
  assert.equal(attachmentFile('attachments/n-0007-1.txt'), null);
  assert.equal(attachmentFile('n-0007-1.png'), null);
});
