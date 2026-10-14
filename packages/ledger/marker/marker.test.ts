/** Run with: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LedgerRefusedError,
  MARKER,
  adoptLedger,
  createLedger,
  inspect,
} from './marker.ts';
import { EventLog } from '../event-log/event-log.ts';
import type { LogEvent } from '../event-log/event-log.ts';

const scratch = () => mkdtemp(path.join(tmpdir(), 'pbnotes-marker-'));

/** Every path under `directory`, so "nothing was written" can be asserted. */
async function everything(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { recursive: true })).sort();
  } catch {
    return [];
  }
}

/** A marker's text with the two version lines replaced. */
async function markerSaying(versions: string): Promise<string> {
  const dir = await scratch();
  await createLedger(dir);
  const text = await readFile(path.join(dir, MARKER), 'utf8');
  return text.replace(/read 1\nwrite 1\n$/, versions);
}

/** A folder as every one was before markers: a device's segments, no `LEDGER`. */
async function unmarked(): Promise<{ dir: string; events: LogEvent[] }> {
  const dir = await scratch();
  await createLedger(dir);
  const log = await EventLog.open(dir, undefined, { device: 'device-a' });
  const events = [
    await log.append('note.written', { text: 'one' }),
    await log.append('note.written', { text: 'two' }),
  ];
  await log.close();
  await mkdir(path.join(dir, 'device-a', 'kept-beside'));
  await writeFile(path.join(dir, 'device-a', 'kept-beside', 'a-file'), 'x');
  await rm(path.join(dir, MARKER));
  return { dir, events };
}

async function refusal(directory: string): Promise<string> {
  try {
    await (await EventLog.open(directory)).close();
  } catch (error) {
    assert.ok(error instanceof LedgerRefusedError, String(error));
    return error.reason;
  }
  return 'opened';
}

test('a created ledger opens, and its marker is the same bytes every time', async () => {
  const a = path.join(await scratch(), 'not', 'there', 'yet');
  const b = await scratch();
  await createLedger(a);
  await createLedger(b);

  assert.equal(await inspect(a), 'ledger');
  assert.equal(await refusal(a), 'opened');
  const text = await readFile(path.join(a, MARKER), 'utf8');
  assert.equal(text, await readFile(path.join(b, MARKER), 'utf8'));
  assert.match(text, /^Signature: bULhVFqraHDHescwKKhK0g==\n(#.*\n)+read 1\nwrite 1\n$/);
});

test('opening never makes a ledger: nothing is written where there is none', async () => {
  const empty = await scratch();
  assert.equal(await refusal(empty), 'missing');
  assert.deepEqual(await everything(empty), []);

  const absent = path.join(await scratch(), 'absent');
  assert.equal(await refusal(absent), 'missing');
  await assert.rejects(readdir(absent), 'the path is still not there');

  // Somebody's own folder, handed over by mistake.
  const unrelated = await scratch();
  await mkdir(path.join(unrelated, 'Photos'));
  await mkdir(path.join(unrelated, 'Taxes'));
  await writeFile(path.join(unrelated, 'Taxes', '2026.pdf'), 'x');
  const before = await everything(unrelated);
  assert.equal(await refusal(unrelated), 'not-a-ledger');
  assert.deepEqual(await everything(unrelated), before);
});

test('a folder with nothing in it but what Finder left can still be created', async () => {
  const dir = await scratch();
  await writeFile(path.join(dir, '.DS_Store'), 'x');
  assert.equal(await inspect(dir), 'missing');
  await createLedger(dir);
  assert.equal(await inspect(dir), 'ledger');
});

test('an unmarked folder is refused until it is adopted, and reads the same after', async () => {
  const { dir, events } = await unmarked();
  const before = await everything(dir);
  assert.equal(await refusal(dir), 'unmarked');
  assert.deepEqual(await everything(dir), before, 'a refusal writes nothing');

  await adoptLedger(dir);
  // The marker, and nothing else touched.
  assert.deepEqual(await everything(dir), [...before, MARKER].sort());

  const read: LogEvent[] = [];
  const log = await EventLog.open(dir, (event) => read.push(event), {
    device: 'device-a',
  });
  assert.deepEqual(read, events);
  assert.deepEqual(log.status.ignored, [], 'the marker is not a stray file');
  await log.close();

  // A second open finds the marker and changes nothing.
  const marked = await everything(dir);
  const text = await readFile(path.join(dir, MARKER), 'utf8');
  await (await EventLog.open(dir, undefined, { device: 'device-a' })).close();
  assert.deepEqual(await everything(dir), marked);
  assert.equal(await readFile(path.join(dir, MARKER), 'utf8'), text);
});

test('a marker that arrived in the meantime is left as it is', async () => {
  const { dir } = await unmarked();
  const arrived = await markerSaying('read 1\nwrite 1\n');
  // Same versions, different words for the person reading it: what a later
  // build on another machine might have written.
  const theirs = arrived.replace(/^# .*$/m, '# Written elsewhere.');
  await writeFile(path.join(dir, MARKER), theirs);

  assert.equal(await inspect(dir), 'ledger');
  await assert.rejects(adoptLedger(dir), /not an unmarked ledger/);
  assert.equal(await readFile(path.join(dir, MARKER), 'utf8'), theirs);
});

test('a newer format is refused and not written to', async () => {
  for (const versions of ['read 2\nwrite 2\n', 'read 1\nwrite 2\n', 'read 2\nwrite 1\n']) {
    const { dir } = await unmarked();
    await writeFile(path.join(dir, MARKER), await markerSaying(versions));
    const before = await everything(dir);

    assert.equal(await inspect(dir), 'newer', versions);
    assert.equal(await refusal(dir), 'newer', versions);
    assert.deepEqual(await everything(dir), before, versions);
  }
});

test('a LEDGER file that is not the marker proves nothing', async () => {
  const good = await markerSaying('read 1\nwrite 1\n');
  const wrong = [
    'pbnotes-ledger 1\n',
    good.replace('bULhVFqraHDHescwKKhK0g==', 'AAAAAAAAAAAAAAAAAAAAAA=='),
    good.replace(/\n/g, '\r\n'),
    good.trimEnd(),
    good + 'extra 1\n',
    good.replace('read 1\n', ''),
    good.replace('read 1', 'read 0'),
    good.replace('write 1', 'write one'),
    '',
  ];
  for (const text of wrong) {
    const { dir } = await unmarked();
    await writeFile(path.join(dir, MARKER), text);
    assert.equal(await inspect(dir), 'not-a-ledger', JSON.stringify(text));
    assert.equal(await refusal(dir), 'not-a-ledger', JSON.stringify(text));
  }

  // A directory by that name is not one either.
  const { dir } = await unmarked();
  await mkdir(path.join(dir, MARKER));
  assert.equal(await inspect(dir), 'not-a-ledger');
});

test('creating and adopting each refuse what the other is for', async () => {
  const { dir } = await unmarked();
  await assert.rejects(createLedger(dir), /not empty/);
  assert.equal(await inspect(dir), 'unmarked');

  const empty = await scratch();
  await assert.rejects(adoptLedger(empty), /not an unmarked ledger/);
  assert.deepEqual(await everything(empty), []);

  // Folders, but no segment in any of them: not a shape worth claiming.
  const unrelated = await scratch();
  await mkdir(path.join(unrelated, 'device-a', 'kept-beside'), { recursive: true });
  await assert.rejects(adoptLedger(unrelated), /not an unmarked ledger/);
  await assert.rejects(createLedger(unrelated), /not empty/);
  assert.deepEqual(await readdir(unrelated), ['device-a']);
});

test("a conflicted copy of the marker is reported, the marker is not", async () => {
  const dir = await scratch();
  await createLedger(dir);
  await writeFile(path.join(dir, `${MARKER} (conflicted copy)`), 'x');
  const log = await EventLog.open(dir);
  assert.deepEqual(
    log.status.ignored.map((it) => path.basename(it)),
    [`${MARKER} (conflicted copy)`],
  );
  await log.close();
});
