# web-nfc

_A friendly wrapper around the browser's Web NFC API. One plain object per tap, a real `stop()`, and errors you can switch on._

[![npm version](https://img.shields.io/npm/v/web-nfc.svg)](https://www.npmjs.com/package/web-nfc)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/web-nfc)](https://bundlephobia.com/package/web-nfc)
[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/vishalmeena2211/web-nfc/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![GitHub](https://img.shields.io/badge/GitHub-vishalmeena2211%2Fweb--nfc-181717?logo=github)](https://github.com/vishalmeena2211/web-nfc)

**Chrome for Android only.** Web NFC ships in Chrome/Edge on Android 89+, over HTTPS, and nowhere else — not desktop Chrome, not Safari, not Firefox, and not iOS. This package tells you that honestly through `isSupported()` instead of failing at the first tap. See [Browser support](#browser-support).

```js
// Before — raw NDEFReader
const reader = new NDEFReader();
const ac = new AbortController();                     // the only way to ever stop
await reader.scan({ signal: ac.signal });             // resolves on start, not on a tag
reader.onreading = (e) => {
  const r = e.message.records[0];
  const bytes = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength); // offset trap
  console.log(new TextDecoder(r.encoding || 'utf-8').decode(bytes), r.lang);
};

// After
const scan = await Nfc.scan({ onTag: (t) => console.log(t.text, t.url, t.serialNumber) });
scan.stop();
```

## Why this exists

Every NFC package on npm is Cordova, Capacitor, React Native, or a Node smartcard binding. None of them wrap the *browser* API. And the browser API has sharp edges:

- **`scan()` has no stop method.** `reader.scan()` resolves once scanning *starts*, then `reading` events arrive forever. The only way to stop is to abort an `AbortController` you remembered to create and hold on to. Here, `scan()` returns a handle with `stop()`.
- **Only one scan at a time.** A second `scan()` while one is live throws a bare `InvalidStateError`. This package tracks the live scan and rejects with a readable `'already-scanning'` error before the platform gets a chance to.
- **Scanning dies when the page is backgrounded.** Web NFC only delivers events while the document is visible, and it does not resume by itself when you come back. With `autoResume` (on by default) the scan restarts on `visibilitychange`, keeping the same `onTag` and the same `stop()` handle.
- **Decoding is manual and fiddly.** `record.data` is a `DataView`. You pick the `TextDecoder` from `record.encoding`, handle `'text'`, `'url'`, `'absolute-url'`, `'mime'`, `'smart-poster'`, `'empty'`, `'unknown'` and external types yourself, and remember that `record.lang` lives beside the payload, not inside it.
- **The `byteOffset` trap.** The platform's `DataView` is usually a *window* into a larger buffer, so `new Uint8Array(view.buffer)` silently gives you the whole tag payload plus its neighbours. This package always slices with `byteOffset`/`byteLength`.
- **Opaque error names.** `NotAllowedError`, `NotSupportedError`, `NetworkError` — none of these say what actually went wrong. Here they become `'permission-denied'`, `'no-hardware'` and `'tag-moved'`, each with a sentence a user could read.
- **`write()` hangs forever.** The raw write promise never settles until a tag arrives. This one takes a `timeoutMs` (15s by default) and rejects with `'timeout'`.

## Install

```bash
npm install web-nfc
```

Or straight from a CDN — the IIFE build exposes the global `WebNfc`:

```html
<script src="https://unpkg.com/web-nfc"></script>
<script>
  if (WebNfc.isSupported()) WebNfc.scan({ onTag: (t) => console.log(t.text) });
</script>
```

No runtime dependencies. React is an optional peer dependency, used only by `web-nfc/react`.

## Quick start

```js
import Nfc from 'web-nfc';

const button = document.querySelector('#scan');
let scan = null;

// The first scan needs a user gesture so the permission prompt can appear.
button.addEventListener('click', async () => {
  if (!Nfc.isSupported()) {
    alert('NFC needs Chrome on Android, over HTTPS.');
    return;
  }

  if (scan?.active) {
    scan.stop();
    return;
  }

  try {
    scan = await Nfc.scan({
      onTag(tag) {
        console.log('serial', tag.serialNumber);
        console.log('text', tag.text);
        console.log('url', tag.url);
        console.log('records', tag.records);
      },
      onError(err) {
        console.warn(err.code, err.message);
      },
    });
  } catch (err) {
    console.error(err.code, err.message); // 'permission-denied', 'no-hardware', ...
  }
});
```

Named imports work identically:

```js
import { scan, write, read, isSupported, NfcError } from 'web-nfc';
```

## React

```tsx
import { useNfc } from 'web-nfc/react';

export function TagReader() {
  const { supported, scanning, lastTag, error, start, stop } = useNfc();

  if (!supported) {
    return <p>NFC needs Chrome on Android, served over HTTPS.</p>;
  }

  return (
    <div>
      {/* start() from an onClick keeps the permission prompt happy */}
      <button onClick={scanning ? stop : start}>
        {scanning ? 'Stop scanning' : 'Scan a tag'}
      </button>

      {error && <p role="alert">{error.code}: {error.message}</p>}

      {lastTag && (
        <dl>
          <dt>Serial</dt><dd>{lastTag.serialNumber ?? '—'}</dd>
          <dt>Text</dt><dd>{lastTag.text ?? '—'}</dd>
          <dt>URL</dt><dd>{lastTag.url ?? '—'}</dd>
        </dl>
      )}
    </div>
  );
}
```

The hook stops the scan on unmount, so no reader and no `visibilitychange` listener is ever left behind. It also exposes `write(message, options?)` for writing from the same component.

## API

### `isSupported(): boolean`

`true` only when `NDEFReader` exists **and** `window.isSecureContext` is true. Always `false` on the server.

### `scan(options): Promise<NfcScan>`

Starts scanning. Resolves once scanning has started; tags then arrive through `onTag` until you call `stop()`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `onTag` | `(tag: NfcTag) => void` | — | **Required.** Called once per tap with the decoded tag. |
| `onError` | `(err: NfcError) => void` | — | Unreadable tag, or a failed auto-resume. |
| `signal` | `AbortSignal` | — | Aborting it stops the scan, exactly like `stop()`. |
| `autoResume` | `boolean` | `true` | Restart scanning when the page becomes visible again. |
| `once` | `boolean` | `false` | Stop automatically after the first tag. |

### `read(options?): Promise<NfcTag>`

Convenience: wait for one tap, resolve with it, then stop.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `signal` | `AbortSignal` | — | Abort to give up waiting. |
| `timeoutMs` | `number` | none | Reject with `'timeout'` after this long. |
| `onError` | `(err: NfcError) => void` | — | Reported while still waiting; the promise keeps waiting. |

### `write(message, options?): Promise<void>`

Writes to the next tag presented. `message` is anything [`toNdefMessage`](#tondefmessagemessage-options-ndefmessageinit) accepts.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `overwrite` | `boolean` | `true` | Overwrite an existing message on the tag. |
| `signal` | `AbortSignal` | — | Abort to cancel the pending write. |
| `timeoutMs` | `number` | `15000` | Reject with `'timeout'` if no tag arrives. |
| `as` | `'text' \| 'url'` | `'text'` | How to read a bare string argument. |

### `makeReadOnly(options?): Promise<void>`

Permanently locks the next tag presented. **Irreversible.** Takes `signal` and `timeoutMs` (default `15000`).

### `decodeMessage(message): NfcRecord[]`

Pure. Decodes anything shaped like `{ records: [...] }` — including a real `NDEFMessage` — into plain objects. It never throws: a malformed record comes back with `data: null` and its raw `bytes`.

### `toNdefMessage(message, options?): NdefMessageInit`

Pure. Normalises a forgiving input into the exact structure `NDEFReader.write()` wants.

| Input | Produces |
| --- | --- |
| `'hello'` | `{ recordType: 'text', data: 'hello' }` |
| `'https://x.dev'` + `{ as: 'url' }` | `{ recordType: 'url', data: 'https://x.dev' }` |
| `new URL('https://x.dev')` | `{ recordType: 'url', data: 'https://x.dev' }` |
| `{ text, lang?, encoding? }` | a `text` record |
| `{ url }` | a `url` record (rejects non-absolute http(s) URLs) |
| `{ json }` | a `mime` record, `application/json`, UTF-8 bytes |
| `{ mediaType, data }` | a `mime` record; `data` may be a string, `ArrayBuffer` or typed array |
| an array of any of the above | a multi-record message |

### `toNfcTag(message, serialNumber?): NfcTag` · `toNfcError(err): NfcError` · `getActiveScan(): NfcScan \| null`

`toNfcTag` builds the friendly tag object from a raw message. `toNfcError` normalises any thrown value. `getActiveScan` returns the one live scan, if there is one.

### Types

```ts
interface NfcScan { stop(): void; readonly active: boolean }

interface NfcTag {
  serialNumber: string | null;
  records: NfcRecord[];
  text: string | null;   // first 'text' record
  url: string | null;    // first 'url' / 'absolute-url' record
  json: unknown | null;  // first JSON 'mime' record
  raw: NDEFMessageLike;
}

interface NfcRecord {
  recordType: string;          // 'text' | 'url' | 'mime' | 'smart-poster' | 'empty' | 'unknown' | 'example.com:mytype'
  mediaType: string | null;
  id: string | null;
  encoding: string | null;     // real tags use 'utf-8' or 'utf-16'
  lang: string | null;
  data: unknown;               // best decoded value for the type
  text?: string;
  url?: string;
  json?: unknown;
  bytes: Uint8Array | null;    // always the exact payload, byteOffset-correct
}
```

Also exported: `NfcError`, `NfcErrorCode`, `ScanOptions`, `ReadOptions`, `WriteOptions`, `MakeReadOnlyOptions`, `WritableMessage`, `WritableRecord`, `TextRecordInput`, `UrlRecordInput`, `JsonRecordInput`, `MimeRecordInput`, `NdefMessageInit`, `NdefRecordInit`, `ToNdefMessageOptions`, `NDEFMessageLike`, `NDEFRecordLike`, `NDEFReadingEventLike`, `UseNfcOptions`, `UseNfcResult`.

### Error codes

Every failure is an `NfcError` with a `code` and the original error kept as `cause`.

| `code` | Platform name | Means |
| --- | --- | --- |
| `unsupported` | — | No `NDEFReader`. Not Chrome on Android. |
| `insecure-context` | — | Page is not HTTPS or `localhost`. |
| `permission-denied` | `NotAllowedError` | User denied NFC, or the page is not focused / had no user gesture. |
| `no-hardware` | `NotSupportedError` | No NFC radio, or NFC is off in system settings. |
| `read-failed` | `NotReadableError` | The tag could not be read. |
| `tag-moved` | `NetworkError` | The tag left the field mid-operation. The classic write failure. |
| `aborted` | `AbortError` | You aborted it. |
| `already-scanning` | `InvalidStateError` | A scan is already running. |
| `invalid-message` | `TypeError` | The message could not be encoded. |
| `timeout` | — | `timeoutMs` elapsed with no tag. |
| `unknown` | anything else | Original message is appended. |

```js
try {
  await Nfc.write({ url: 'https://example.com' });
} catch (err) {
  if (err.code === 'tag-moved') retry();
  else if (err.code === 'permission-denied') showPermissionHelp();
}
```

## Browser support

| Browser | Web NFC | What this package does |
| --- | --- | --- |
| Chrome / Edge on Android 89+ | ✅ over HTTPS | Everything works. |
| Chrome on Android over plain HTTP | ❌ insecure context | `isSupported()` → `false`; calls reject with `'insecure-context'`. |
| Chrome / Edge on desktop | ❌ | `isSupported()` → `false`; calls reject with `'unsupported'`. |
| Safari (macOS and iOS) | ❌ | `isSupported()` → `false`; calls reject with `'unsupported'`. |
| Firefox | ❌ | `isSupported()` → `false`; calls reject with `'unsupported'`. |
| Node / SSR | ❌ | Import is safe; `isSupported()` → `false`; calls reject with `'unsupported'`. |

**iOS has no Web NFC.** iPhones read NFC tags at the OS level — background tag reading opens URLs from the lock screen, and native apps use Core NFC — but Safari exposes none of that to a web page, and no third-party iOS browser can add it. If your product needs NFC on iPhone, it needs a native app. Feature-detect with `isSupported()` and offer a QR code fallback.

## Recipes

**Read a single tag**

```js
try {
  const tag = await Nfc.read({ timeoutMs: 20000 });
  console.log(tag.serialNumber, tag.text ?? tag.url);
} catch (err) {
  if (err.code === 'timeout') console.log('No tag was presented.');
}
```

**Continuous scanning that survives backgrounding**

```js
const scan = await Nfc.scan({
  autoResume: true, // the default: restarts on visibilitychange
  onTag: (tag) => addRow(tag.serialNumber, tag.text),
  onError: (err) => console.warn(err.code, err.message),
});

// later, e.g. when leaving the screen
scan.stop();
```

**Write a URL**

```js
await Nfc.write({ url: 'https://example.com/checkin/42' });
// or: await Nfc.write('https://example.com/checkin/42', { as: 'url' });
```

**Write JSON (plus a human-readable label)**

```js
await Nfc.write([
  { text: 'Desk 12', lang: 'en' },
  { json: { desk: 12, floor: 3, updated: Date.now() } },
]);
```

Reading it back:

```js
const tag = await Nfc.read();
console.log(tag.text);        // 'Desk 12'
console.log(tag.json.floor);  // 3
```

**Lock a tag forever**

```js
// There is no unlock. None. Confirm with the user first.
if (confirm('Permanently lock this tag? This cannot be undone.')) {
  await Nfc.makeReadOnly({ timeoutMs: 20000 });
}
```

## Testing without hardware

`decodeMessage()` and `toNdefMessage()` are pure functions with no DOM access, so the interesting half of any NFC feature can be tested in plain Node — that is how this package's own suite works. Build a fake record by hand:

```js
import { decodeMessage } from 'web-nfc';

const payload = new TextEncoder().encode('hello tag');
const [record] = decodeMessage({
  records: [{ recordType: 'text', encoding: 'utf-8', lang: 'en', data: new DataView(payload.buffer) }],
});
record.text; // 'hello tag'
```

Chrome DevTools has **no NFC emulation** — there is no equivalent of the sensors or geolocation panels. Anything involving a real tap needs a physical Android phone, remote-debugged over `chrome://inspect` with port forwarding to your dev server (or an HTTPS tunnel, since Web NFC needs a secure context).

## Gotchas

- **User gesture required.** The first `scan()` or `write()` must run inside a click/tap handler or the permission prompt is suppressed and you get `'permission-denied'`. When that happens and `navigator.userActivation.isActive` is `false`, the error message says so explicitly.
- **The page must be focused and visible.** A background tab receives no `reading` events at all. `autoResume` covers coming back; it cannot help while you are away.
- **One scan per page.** `scan()` rejects with `'already-scanning'` rather than letting the platform throw. Call `stop()` first, or check `getActiveScan()`.
- **`serialNumber` is not an identity.** Some tags report a random UID on each tap, and it is never a substitute for a signed token.
- **Writes need the tag to stay still.** Moving it away mid-write gives `'tag-moved'` — retry, don't treat it as fatal.
- **`makeReadOnly()` is permanent.** No unlock exists at any layer.
- **Tag capacity is small.** NTAG213 holds ~144 bytes of NDEF, NTAG216 ~888. A fat JSON blob will not fit; store an ID and look the rest up.
- **NFC must be enabled in Android settings.** If the radio is off you get `'no-hardware'`, and the web page cannot turn it on — you have to tell the user to.

## Contributing

```bash
git clone https://github.com/vishalmeena2211/web-nfc.git
cd web-nfc
npm install
npm run dev        # tsup --watch
npm run typecheck
npm test
```

The demo in `demo/index.html` loads `../dist/index.global.js`, so run `npm run build` and serve the folder over a local server — over HTTPS, from an Android phone, if you want the NFC parts to do anything.

## Links

- **Repository** — [github.com/vishalmeena2211/web-nfc](https://github.com/vishalmeena2211/web-nfc)
- **npm** — [npmjs.com/package/web-nfc](https://www.npmjs.com/package/web-nfc)
- **Issues & feature requests** — [Report an issue](https://github.com/vishalmeena2211/web-nfc/issues)
- **Changelog** — [releases](https://github.com/vishalmeena2211/web-nfc/releases)

## License

MIT © Vishal Meena
