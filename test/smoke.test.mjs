/**
 * Zero-dependency tests, run against the built bundle in ../dist.
 *
 * There is no DOM and no NFC hardware here: the decoder is fed hand-built
 * record objects backed by real DataViews, which is exactly what makes it
 * unit-testable in the first place.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import Nfc, {
  NfcError,
  decodeMessage,
  isSupported,
  makeReadOnly,
  read,
  scan,
  toNdefMessage,
  toNfcError,
  toNfcTag,
  write,
} from '../dist/index.js';

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

const utf8 = (s) => new TextEncoder().encode(s);

/** A DataView starting at offset 0 of its own buffer. */
function view(bytes) {
  const copy = new Uint8Array(bytes);
  return new DataView(copy.buffer, 0, copy.length);
}

/**
 * A DataView that is a *window* into a larger buffer — the shape real Web NFC
 * hands you, and the one that breaks `new Uint8Array(view.buffer)`.
 */
function offsetView(bytes, padBefore, padAfter) {
  const payload = new Uint8Array(bytes);
  const buffer = new ArrayBuffer(padBefore + payload.length + padAfter);
  const whole = new Uint8Array(buffer);
  whole.fill(0xff);
  whole.set(payload, padBefore);
  return new DataView(buffer, padBefore, payload.length);
}

const decodeText = (bytes) => new TextDecoder().decode(bytes);

/* -------------------------------------------------------------------------- */
/* 1. SSR safety                                                              */
/* -------------------------------------------------------------------------- */

test('SSR: importing with no window throws nothing and isSupported() is false', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(isSupported(), false);
});

test('SSR: scan() rejects with code "unsupported"', async () => {
  await assert.rejects(
    () => scan({ onTag: () => {} }),
    (err) => {
      assert.ok(err instanceof NfcError);
      assert.equal(err.code, 'unsupported');
      assert.match(err.message, /Chrome for Android/);
      return true;
    },
  );
});

test('SSR: write() and makeReadOnly() reject with code "unsupported"', async () => {
  await assert.rejects(
    () => write('hello'),
    (err) => err instanceof NfcError && err.code === 'unsupported',
  );
  await assert.rejects(
    () => makeReadOnly(),
    (err) => err instanceof NfcError && err.code === 'unsupported',
  );
});

test('SSR: read() rejects with code "unsupported"', async () => {
  await assert.rejects(
    () => read(),
    (err) => err instanceof NfcError && err.code === 'unsupported',
  );
});

/* -------------------------------------------------------------------------- */
/* 2. API surface                                                             */
/* -------------------------------------------------------------------------- */

test('API surface: every documented export exists with the right type', () => {
  for (const fn of [
    isSupported,
    scan,
    read,
    write,
    makeReadOnly,
    decodeMessage,
    toNdefMessage,
    toNfcTag,
    toNfcError,
  ]) {
    assert.equal(typeof fn, 'function');
  }
  assert.equal(typeof NfcError, 'function');
  assert.equal(typeof Nfc, 'object');
  for (const key of [
    'isSupported',
    'scan',
    'read',
    'write',
    'makeReadOnly',
    'decodeMessage',
    'toNfcTag',
    'toNdefMessage',
    'toNfcError',
    'getActiveScan',
    'NfcError',
  ]) {
    assert.ok(key in Nfc, `default export is missing ${key}`);
  }
  assert.equal(Nfc.scan, scan);
  assert.equal(Nfc.NfcError, NfcError);
});

test('API surface: NfcError carries code, message and cause', () => {
  const cause = new Error('boom');
  const err = new NfcError('timeout', 'timed out', cause);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof NfcError);
  assert.equal(err.name, 'NfcError');
  assert.equal(err.code, 'timeout');
  assert.equal(err.message, 'timed out');
  assert.equal(err.cause, cause);
});

/* -------------------------------------------------------------------------- */
/* 3. decodeMessage                                                           */
/* -------------------------------------------------------------------------- */

test('decodeMessage: text record decodes UTF-8 and surfaces lang', () => {
  const [record] = decodeMessage({
    records: [
      {
        recordType: 'text',
        encoding: 'utf-8',
        lang: 'en',
        data: view(utf8('hello tag')),
      },
    ],
  });

  assert.equal(record.recordType, 'text');
  assert.equal(record.text, 'hello tag');
  assert.equal(record.data, 'hello tag');
  assert.equal(record.lang, 'en');
  assert.equal(record.encoding, 'utf-8');
  assert.equal(record.mediaType, null);
  assert.equal(record.id, null);
  assert.equal(decodeText(record.bytes), 'hello tag');
});

test('decodeMessage: honours a DataView with a non-zero byteOffset', () => {
  const dataView = offsetView(utf8('offset safe'), 7, 11);
  assert.equal(dataView.byteOffset, 7);
  assert.notEqual(dataView.byteLength, dataView.buffer.byteLength);

  const [record] = decodeMessage({
    records: [{ recordType: 'text', encoding: 'utf-8', lang: 'en', data: dataView }],
  });

  assert.equal(record.text, 'offset safe');
  assert.equal(record.bytes.length, 11);
  assert.equal(decodeText(record.bytes), 'offset safe');
});

test('decodeMessage: text record with utf-16 encoding', () => {
  const utf16 = new Uint8Array([0x68, 0x00, 0x69, 0x00]); // "hi" little-endian
  const [record] = decodeMessage({
    records: [{ recordType: 'text', encoding: 'utf-16', lang: 'en', data: view(utf16) }],
  });
  assert.equal(record.text, 'hi');
});

test('decodeMessage: url record', () => {
  const [record] = decodeMessage({
    records: [{ recordType: 'url', data: view(utf8('https://example.com/a')) }],
  });
  assert.equal(record.recordType, 'url');
  assert.equal(record.url, 'https://example.com/a');
  assert.equal(record.data, 'https://example.com/a');
  assert.equal(record.text, undefined);
});

test('decodeMessage: absolute-url record', () => {
  const [record] = decodeMessage({
    records: [{ recordType: 'absolute-url', data: view(utf8('https://example.com/abs')) }],
  });
  assert.equal(record.url, 'https://example.com/abs');
});

test('decodeMessage: application/json mime record parses', () => {
  const [record] = decodeMessage({
    records: [
      {
        recordType: 'mime',
        mediaType: 'application/json',
        data: view(utf8('{"id":7,"tags":["a","b"]}')),
      },
    ],
  });
  assert.equal(record.recordType, 'mime');
  assert.equal(record.mediaType, 'application/json');
  assert.deepEqual(record.json, { id: 7, tags: ['a', 'b'] });
  assert.deepEqual(record.data, { id: 7, tags: ['a', 'b'] });
});

test('decodeMessage: a +json media type also parses', () => {
  const [record] = decodeMessage({
    records: [
      {
        recordType: 'mime',
        mediaType: 'application/vnd.example+json',
        data: view(utf8('{"ok":true}')),
      },
    ],
  });
  assert.deepEqual(record.json, { ok: true });
});

test('decodeMessage: broken JSON fails soft to raw text, never throws', () => {
  const [record] = decodeMessage({
    records: [
      { recordType: 'mime', mediaType: 'application/json', data: view(utf8('{not json')) },
    ],
  });
  assert.equal(record.json, undefined);
  assert.equal(record.text, '{not json');
  assert.equal(record.data, '{not json');
  assert.equal(decodeText(record.bytes), '{not json');
});

test('decodeMessage: binary mime record exposes bytes only', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const [record] = decodeMessage({
    records: [{ recordType: 'mime', mediaType: 'image/png', data: view(png) }],
  });
  assert.equal(record.data, null);
  assert.equal(record.json, undefined);
  assert.deepEqual(Array.from(record.bytes), [0x89, 0x50, 0x4e, 0x47]);
});

test('decodeMessage: empty record has no payload', () => {
  const [record] = decodeMessage({ records: [{ recordType: 'empty', data: view([]) }] });
  assert.equal(record.recordType, 'empty');
  assert.equal(record.data, null);
  assert.equal(record.bytes, null);
});

test('decodeMessage: unknown external type yields bytes only', () => {
  const [record] = decodeMessage({
    records: [{ recordType: 'example.com:mytype', data: view([1, 2, 3, 4]) }],
  });
  assert.equal(record.recordType, 'example.com:mytype');
  assert.equal(record.data, null);
  assert.equal(record.text, undefined);
  assert.deepEqual(Array.from(record.bytes), [1, 2, 3, 4]);
});

test('decodeMessage: smart-poster recurses through toRecords()', () => {
  const [record] = decodeMessage({
    records: [
      {
        recordType: 'smart-poster',
        data: view(utf8('nested')),
        toRecords: () => [
          { recordType: 'url', data: view(utf8('https://example.com/sp')) },
          { recordType: 'text', encoding: 'utf-8', lang: 'en', data: view(utf8('Open me')) },
        ],
      },
    ],
  });
  assert.equal(record.recordType, 'smart-poster');
  assert.ok(Array.isArray(record.data));
  assert.equal(record.data.length, 2);
  assert.equal(record.data[0].url, 'https://example.com/sp');
  assert.equal(record.url, 'https://example.com/sp');
  assert.equal(record.text, 'Open me');
});

test('decodeMessage: malformed records never throw', () => {
  const records = decodeMessage({
    records: [
      { recordType: 'text', data: null },
      { recordType: 'mime', mediaType: 'application/json', data: undefined },
      {},
    ],
  });
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.equal(record.data, null);
    assert.equal(record.bytes, null);
  }
  assert.equal(records[2].recordType, 'unknown');
});

test('decodeMessage: null and empty inputs return []', () => {
  assert.deepEqual(decodeMessage(null), []);
  assert.deepEqual(decodeMessage(undefined), []);
  assert.deepEqual(decodeMessage({}), []);
  assert.deepEqual(decodeMessage({ records: [] }), []);
});

/* -------------------------------------------------------------------------- */
/* toNfcTag                                                                   */
/* -------------------------------------------------------------------------- */

test('toNfcTag: exposes first text / url / json plus the raw message', () => {
  const message = {
    records: [
      { recordType: 'text', encoding: 'utf-8', lang: 'en', data: view(utf8('label')) },
      { recordType: 'url', data: view(utf8('https://example.com')) },
      { recordType: 'mime', mediaType: 'application/json', data: view(utf8('{"a":1}')) },
    ],
  };
  const tag = toNfcTag(message, '04:a2:24:8b');

  assert.equal(tag.serialNumber, '04:a2:24:8b');
  assert.equal(tag.records.length, 3);
  assert.equal(tag.text, 'label');
  assert.equal(tag.url, 'https://example.com');
  assert.deepEqual(tag.json, { a: 1 });
  assert.equal(tag.raw, message);
});

test('toNfcTag: missing serial number and missing kinds are null', () => {
  const tag = toNfcTag({ records: [{ recordType: 'empty', data: null }] });
  assert.equal(tag.serialNumber, null);
  assert.equal(tag.text, null);
  assert.equal(tag.url, null);
  assert.equal(tag.json, null);
});

/* -------------------------------------------------------------------------- */
/* 4. toNdefMessage                                                           */
/* -------------------------------------------------------------------------- */

test('toNdefMessage: bare string becomes a text record', () => {
  assert.deepEqual(toNdefMessage('hello'), {
    records: [{ recordType: 'text', data: 'hello' }],
  });
});

test('toNdefMessage: bare string with { as: "url" } becomes a url record', () => {
  assert.deepEqual(toNdefMessage('https://example.com/x', { as: 'url' }), {
    records: [{ recordType: 'url', data: 'https://example.com/x' }],
  });
});

test('toNdefMessage: { as: "url" } rejects a non-absolute string', () => {
  assert.throws(
    () => toNdefMessage('not a url', { as: 'url' }),
    (err) => err instanceof NfcError && err.code === 'invalid-message',
  );
});

test('toNdefMessage: a URL instance becomes a url record', () => {
  assert.deepEqual(toNdefMessage(new URL('https://example.com/from-url')), {
    records: [{ recordType: 'url', data: 'https://example.com/from-url' }],
  });
});

test('toNdefMessage: { text, lang, encoding }', () => {
  assert.deepEqual(toNdefMessage({ text: 'bonjour', lang: 'fr', encoding: 'utf-8' }), {
    records: [{ recordType: 'text', data: 'bonjour', lang: 'fr', encoding: 'utf-8' }],
  });
  assert.deepEqual(toNdefMessage({ text: 'plain' }), {
    records: [{ recordType: 'text', data: 'plain' }],
  });
});

test('toNdefMessage: { url } accepts a string or a URL', () => {
  assert.deepEqual(toNdefMessage({ url: 'https://example.com/a' }), {
    records: [{ recordType: 'url', data: 'https://example.com/a' }],
  });
  assert.deepEqual(toNdefMessage({ url: new URL('https://example.com/b') }), {
    records: [{ recordType: 'url', data: 'https://example.com/b' }],
  });
  assert.throws(
    () => toNdefMessage({ url: 'ftp://example.com' }),
    (err) => err instanceof NfcError && err.code === 'invalid-message',
  );
});

test('toNdefMessage: { json } becomes UTF-8 application/json bytes', () => {
  const message = toNdefMessage({ json: { id: 7, ok: true } });
  assert.equal(message.records.length, 1);
  const [record] = message.records;
  assert.equal(record.recordType, 'mime');
  assert.equal(record.mediaType, 'application/json');
  assert.ok(record.data instanceof Uint8Array);
  assert.equal(decodeText(record.data), '{"id":7,"ok":true}');
});

test('toNdefMessage: { mediaType, data } accepts strings and binary', () => {
  const fromString = toNdefMessage({ mediaType: 'text/csv', data: 'a,b\n1,2' });
  assert.equal(fromString.records[0].mediaType, 'text/csv');
  assert.equal(decodeText(fromString.records[0].data), 'a,b\n1,2');

  const bytes = new Uint8Array([9, 8, 7]);
  const fromBytes = toNdefMessage({ mediaType: 'application/octet-stream', data: bytes });
  assert.deepEqual(Array.from(fromBytes.records[0].data), [9, 8, 7]);
});

test('toNdefMessage: an array produces a multi-record message', () => {
  const message = toNdefMessage([
    'label',
    { url: 'https://example.com' },
    { json: [1, 2] },
    { text: 'hallo', lang: 'de' },
  ]);
  assert.equal(message.records.length, 4);
  assert.deepEqual(message.records[0], { recordType: 'text', data: 'label' });
  assert.deepEqual(message.records[1], { recordType: 'url', data: 'https://example.com' });
  assert.equal(message.records[2].mediaType, 'application/json');
  assert.equal(decodeText(message.records[2].data), '[1,2]');
  assert.deepEqual(message.records[3], { recordType: 'text', data: 'hallo', lang: 'de' });
});

test('toNdefMessage: rejects an empty array and unrecognised shapes', () => {
  assert.throws(
    () => toNdefMessage([]),
    (err) => err instanceof NfcError && err.code === 'invalid-message',
  );
  assert.throws(
    () => toNdefMessage({ nope: 1 }),
    (err) => err instanceof NfcError && err.code === 'invalid-message',
  );
  assert.throws(
    () => toNdefMessage(42),
    (err) => err instanceof NfcError && err.code === 'invalid-message',
  );
});

test('toNdefMessage: round-trips through decodeMessage for json', () => {
  const written = toNdefMessage({ json: { round: 'trip' } });
  const [record] = decodeMessage({
    records: [
      {
        recordType: 'mime',
        mediaType: written.records[0].mediaType,
        data: view(written.records[0].data),
      },
    ],
  });
  assert.deepEqual(record.json, { round: 'trip' });
});

/* -------------------------------------------------------------------------- */
/* 5. Error mapping                                                           */
/* -------------------------------------------------------------------------- */

test('toNfcError: maps every platform error name to a stable code', () => {
  const cases = [
    ['NotAllowedError', 'permission-denied'],
    ['NotSupportedError', 'no-hardware'],
    ['NotReadableError', 'read-failed'],
    ['NetworkError', 'tag-moved'],
    ['AbortError', 'aborted'],
    ['InvalidStateError', 'already-scanning'],
    ['TypeError', 'invalid-message'],
    ['WhoKnowsError', 'unknown'],
  ];

  for (const [name, code] of cases) {
    const original = Object.assign(new Error(`${name} happened`), { name });
    const err = toNfcError(original);
    assert.ok(err instanceof NfcError, `${name} did not produce an NfcError`);
    assert.equal(err.code, code, `${name} should map to ${code}`);
    assert.equal(err.cause, original);
    assert.ok(err.message.length > 0);
  }
});

test('toNfcError: human messages explain the two confusing cases', () => {
  const denied = toNfcError(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
  assert.match(denied.message, /denied NFC access|not focused/);

  const noHardware = toNfcError(Object.assign(new Error('x'), { name: 'NotSupportedError' }));
  assert.match(noHardware.message, /no NFC hardware|turned off/);

  const moved = toNfcError(Object.assign(new Error('x'), { name: 'NetworkError' }));
  assert.match(moved.message, /moved away/);
});

test('toNfcError: already-normalised errors pass through untouched', () => {
  const original = new NfcError('timeout', 'nope');
  assert.equal(toNfcError(original), original);
});

test('toNfcError: non-Error values still normalise', () => {
  const err = toNfcError('something odd');
  assert.ok(err instanceof NfcError);
  assert.equal(err.code, 'unknown');
  assert.equal(err.cause, 'something odd');
});
