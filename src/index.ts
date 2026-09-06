/**
 * nfc-tap — a friendly wrapper around the browser's Web NFC API (`NDEFReader`).
 *
 * The raw API hands you `DataView`s, an event lifecycle with no natural "stop",
 * and error names that tell you nothing. This module turns a tap into a plain
 * JavaScript object and turns failures into typed error codes.
 *
 * Everything here is SSR-safe: importing this module in Node throws nothing.
 *
 * @packageDocumentation
 */

/* -------------------------------------------------------------------------- */
/* Structural types for the Web NFC API                                       */
/* -------------------------------------------------------------------------- */

/**
 * A single NDEF record as the platform exposes it. Modelled structurally so the
 * decoder can be unit tested against hand-built fakes with no DOM present.
 */
export interface NDEFRecordLike {
  /** `'text'`, `'url'`, `'absolute-url'`, `'mime'`, `'smart-poster'`, `'empty'`, `'unknown'`, or an external type such as `'example.com:mytype'`. */
  recordType: string;
  /** MIME type, only meaningful for `'mime'` records. */
  mediaType?: string | null;
  /** Record identifier, usually absent. */
  id?: string | null;
  /** Text encoding for `'text'` records — real tags use `'utf-8'` or `'utf-16'`. */
  encoding?: string | null;
  /** BCP-47 language tag for `'text'` records, e.g. `'en'`. */
  lang?: string | null;
  /** Raw payload. The platform gives a `DataView`; it may be a view into a larger buffer. */
  data?: DataView | ArrayBuffer | ArrayBufferView | null;
  /** Present on `'smart-poster'` and external records: expands the nested NDEF message. */
  toRecords?: () => NDEFRecordLike[];
}

/** An NDEF message as the platform exposes it. */
export interface NDEFMessageLike {
  /** The records carried by the tag, in order. */
  records: NDEFRecordLike[];
}

/** The `reading` event emitted by `NDEFReader`. */
export interface NDEFReadingEventLike extends Event {
  /** The tag's serial number, when the platform could read one. */
  serialNumber?: string;
  /** The NDEF message stored on the tag. */
  message: NDEFMessageLike;
}

/* -------------------------------------------------------------------------- */
/* Public data types                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One decoded NDEF record. `data` holds the most useful decoded value for the
 * record type; `text` / `url` / `json` are populated when they apply, and
 * `bytes` is always the raw payload so nothing is ever lost.
 */
export interface NfcRecord {
  /** The record type verbatim, e.g. `'text'`, `'url'`, `'mime'`, `'example.com:mytype'`. */
  recordType: string;
  /** MIME type for `'mime'` records, otherwise `null`. */
  mediaType: string | null;
  /** Record identifier, or `null`. */
  id: string | null;
  /** Declared text encoding for `'text'` records, or `null`. */
  encoding: string | null;
  /** BCP-47 language tag for `'text'` records, or `null`. */
  lang: string | null;
  /** The decoded payload: a string, a parsed object, nested records, or `null` when undecodable. */
  data: unknown;
  /** Decoded string for `'text'` records. */
  text?: string;
  /** Decoded URL for `'url'` and `'absolute-url'` records. */
  url?: string;
  /** Parsed value for JSON `'mime'` records. */
  json?: unknown;
  /** The raw payload bytes, or `null` when the record carries no payload. */
  bytes: Uint8Array | null;
}

/**
 * One tap. `text`, `url` and `json` are conveniences for the first record of
 * that kind, because in practice almost every tag carries exactly one record.
 */
export interface NfcTag {
  /** The tag's serial number, or `null` when the platform did not report one. */
  serialNumber: string | null;
  /** Every decoded record on the tag, in order. */
  records: NfcRecord[];
  /** The first `'text'` record's string, or `null`. */
  text: string | null;
  /** The first `'url'` / `'absolute-url'` record's URL, or `null`. */
  url: string | null;
  /** The first JSON `'mime'` record's parsed value, or `null`. */
  json: unknown | null;
  /** The untouched platform message, if you need something this wrapper did not decode. */
  raw: NDEFMessageLike;
}

/** A live scan. Scanning continues until you call {@link NfcScan.stop}. */
export interface NfcScan {
  /**
   * Stop scanning: aborts the underlying controller, drops the `reading`
   * listener and removes the `visibilitychange` auto-resume listener.
   * Safe to call more than once.
   */
  stop(): void;
  /** `false` once {@link NfcScan.stop} has been called or the signal aborted. */
  readonly active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** The stable error codes this package normalises platform failures into. */
export type NfcErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'no-hardware'
  | 'read-failed'
  | 'tag-moved'
  | 'aborted'
  | 'already-scanning'
  | 'invalid-message'
  | 'timeout'
  | 'unknown';

/**
 * A normalised NFC failure. The original platform error is kept as
 * {@link NfcError.cause} so nothing is lost.
 */
export class NfcError extends Error {
  /** Stable, switchable error code. */
  readonly code: NfcErrorCode;
  /** The original error, when there was one. */
  readonly cause?: unknown;

  constructor(code: NfcErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'NfcError';
    this.code = code;
    this.cause = cause;
    // Keeps `instanceof` working when the output is down-levelled.
    Object.setPrototypeOf(this, NfcError.prototype);
  }
}

const MESSAGES: Record<NfcErrorCode, string> = {
  'unsupported':
    'Web NFC is not available in this browser. It ships only in Chrome for Android 89+.',
  'insecure-context':
    'Web NFC requires a secure context. Serve the page over HTTPS (localhost is also allowed).',
  'permission-denied': 'The user denied NFC access, or the page is not focused.',
  'no-hardware':
    'This device has no NFC hardware, or NFC is turned off in system settings.',
  'read-failed': 'The tag could not be read. It may be damaged or an unsupported format.',
  'tag-moved': 'The tag was moved away before the operation finished.',
  'aborted': 'The NFC operation was aborted.',
  'already-scanning': 'A scan is already running. Stop it before starting another one.',
  'invalid-message': 'The NDEF message could not be encoded. Check the record shapes you passed.',
  'timeout': 'Timed out waiting for a tag. Hold the tag against the back of the phone and retry.',
  'unknown': 'The NFC operation failed for an unknown reason.',
};

const NAME_TO_CODE: Record<string, NfcErrorCode> = {
  NotAllowedError: 'permission-denied',
  NotSupportedError: 'no-hardware',
  NotReadableError: 'read-failed',
  NetworkError: 'tag-moved',
  AbortError: 'aborted',
  InvalidStateError: 'already-scanning',
  TypeError: 'invalid-message',
  SyntaxError: 'invalid-message',
};

/** True when the page currently has transient user activation, `null` when unknowable. */
function hasUserActivation(): boolean | null {
  if (typeof navigator === 'undefined') return null;
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  if (!activation || typeof activation.isActive !== 'boolean') return null;
  return activation.isActive;
}

/**
 * Normalise any thrown value into an {@link NfcError} with a stable
 * {@link NfcError.code}. Already-normalised errors are returned unchanged.
 *
 * @param err - The value the platform threw or rejected with.
 * @returns A typed error whose `cause` is the original value.
 */
export function toNfcError(err: unknown): NfcError {
  if (err instanceof NfcError) return err;

  const name =
    err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string'
      ? (err as { name: string }).name
      : '';
  const code: NfcErrorCode = NAME_TO_CODE[name] ?? 'unknown';

  let message = MESSAGES[code];
  if (code === 'permission-denied' && hasUserActivation() === false) {
    message +=
      ' The page has no active user gesture — call scan()/write() directly from a click or tap handler.';
  }
  if (code === 'unknown') {
    const raw =
      err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : String(err);
    if (raw) message = `${message} (${raw})`;
  }

  return new NfcError(code, message, err);
}

/* -------------------------------------------------------------------------- */
/* Support detection                                                          */
/* -------------------------------------------------------------------------- */

interface NDEFReaderLike {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(
    message: unknown,
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<void>;
  makeReadOnly(options?: { signal?: AbortSignal }): Promise<void>;
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
}

type NDEFReaderCtor = new () => NDEFReaderLike;

function getReaderCtor(): NDEFReaderCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { NDEFReader?: NDEFReaderCtor }).NDEFReader;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * Whether Web NFC can actually be used right now.
 *
 * Returns `true` only when `NDEFReader` exists *and* the page is a secure
 * context. In practice that means Chrome on Android 89+ served over HTTPS
 * (or `localhost`). Always `false` during server-side rendering.
 */
export function isSupported(): boolean {
  if (getReaderCtor() === null) return false;
  return window.isSecureContext === true;
}

/** Throws the right typed error when NFC cannot be used. */
function assertSupported(): NDEFReaderCtor {
  const ctor = getReaderCtor();
  if (ctor === null) throw new NfcError('unsupported', MESSAGES['unsupported']);
  if (window.isSecureContext !== true) {
    throw new NfcError('insecure-context', MESSAGES['insecure-context']);
  }
  return ctor;
}

/* -------------------------------------------------------------------------- */
/* Decoding                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Copy a payload into a `Uint8Array`, honouring `byteOffset`/`byteLength`.
 *
 * The platform's `DataView` is frequently a *window* into a larger buffer, so
 * `new Uint8Array(view.buffer)` silently returns the whole tag payload plus
 * neighbouring records. This is the single most common Web NFC bug.
 */
function toBytes(data: NDEFRecordLike['data']): Uint8Array | null {
  if (data == null) return null;
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return null;
}

function decodeText(bytes: Uint8Array | null, encoding?: string | null): string | null {
  if (bytes === null) return null;
  try {
    return new TextDecoder(encoding || 'utf-8').decode(bytes);
  } catch {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return null;
    }
  }
}

function isJsonMediaType(mediaType: string | null): boolean {
  if (!mediaType) return false;
  const base = mediaType.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'application/json' || base === 'text/json' || base.endsWith('+json');
}

function decodeRecord(record: NDEFRecordLike): NfcRecord {
  const recordType = typeof record.recordType === 'string' ? record.recordType : 'unknown';
  const mediaType = record.mediaType ?? null;
  const bytes = toBytes(record.data);

  const out: NfcRecord = {
    recordType,
    mediaType,
    id: record.id ?? null,
    encoding: record.encoding ?? null,
    lang: record.lang ?? null,
    data: null,
    bytes,
  };

  switch (recordType) {
    case 'empty':
      out.data = null;
      out.bytes = null;
      return out;

    case 'text': {
      const text = decodeText(bytes, record.encoding);
      if (text !== null) {
        out.text = text;
        out.data = text;
      }
      return out;
    }

    case 'url':
    case 'absolute-url': {
      const url = decodeText(bytes, 'utf-8');
      if (url !== null) {
        out.url = url;
        out.data = url;
      }
      return out;
    }

    case 'mime': {
      if (isJsonMediaType(mediaType)) {
        const text = decodeText(bytes, 'utf-8');
        if (text !== null) {
          try {
            out.json = JSON.parse(text) as unknown;
            out.data = out.json;
          } catch {
            // Fail soft: a malformed JSON payload still yields its text + bytes.
            out.text = text;
            out.data = text;
          }
        }
        return out;
      }
      if (mediaType && (mediaType.startsWith('text/') || mediaType === 'application/xml')) {
        const text = decodeText(bytes, 'utf-8');
        if (text !== null) {
          out.text = text;
          out.data = text;
        }
        return out;
      }
      // Binary MIME payload: bytes only.
      return out;
    }

    case 'smart-poster': {
      if (typeof record.toRecords === 'function') {
        try {
          const nested = record.toRecords();
          if (Array.isArray(nested)) {
            const decoded = nested.map(decodeRecord);
            out.data = decoded;
            const nestedUrl = decoded.find((r) => typeof r.url === 'string');
            if (nestedUrl?.url) out.url = nestedUrl.url;
            const nestedText = decoded.find((r) => typeof r.text === 'string');
            if (nestedText?.text) out.text = nestedText.text;
          }
        } catch {
          // Nested message could not be expanded; bytes are still there.
        }
      }
      return out;
    }

    default:
      // 'unknown' and external types (e.g. 'example.com:mytype'): bytes only.
      return out;
  }
}

/**
 * Decode a platform NDEF message into plain objects. Pure, DOM-free and
 * total — a malformed record yields `{ data: null }` plus its raw `bytes`
 * rather than throwing.
 *
 * @param message - Anything shaped like `{ records: [...] }`, including a real
 *   `NDEFMessage` from a `reading` event.
 * @returns One {@link NfcRecord} per record, in order.
 */
export function decodeMessage(message: NDEFMessageLike | null | undefined): NfcRecord[] {
  if (!message || !Array.isArray(message.records)) return [];
  return message.records.map((record) => {
    try {
      return decodeRecord(record);
    } catch (err) {
      return {
        recordType:
          record && typeof record.recordType === 'string' ? record.recordType : 'unknown',
        mediaType: record?.mediaType ?? null,
        id: record?.id ?? null,
        encoding: record?.encoding ?? null,
        lang: record?.lang ?? null,
        data: null,
        bytes: (() => {
          try {
            return toBytes(record?.data);
          } catch {
            return null;
          }
        })(),
      } satisfies NfcRecord;
    }
  });
}

/**
 * Build the friendly {@link NfcTag} for one tap.
 *
 * @param message - The platform NDEF message.
 * @param serialNumber - The serial number the event reported, if any.
 */
export function toNfcTag(
  message: NDEFMessageLike,
  serialNumber?: string | null,
): NfcTag {
  const records = decodeMessage(message);
  const firstText = records.find((r) => typeof r.text === 'string' && r.recordType === 'text');
  const firstUrl = records.find((r) => typeof r.url === 'string');
  const firstJson = records.find((r) => r.json !== undefined);
  return {
    serialNumber: serialNumber ? serialNumber : null,
    records,
    text: firstText?.text ?? null,
    url: firstUrl?.url ?? null,
    json: firstJson === undefined ? null : firstJson.json,
    raw: message,
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/** A `text` record. */
export interface TextRecordInput {
  /** The string to store. */
  text: string;
  /** BCP-47 language tag, e.g. `'en'`. Defaults to the platform's choice. */
  lang?: string;
  /** `'utf-8'` (default) or `'utf-16'`. */
  encoding?: string;
}

/** A `url` record. */
export interface UrlRecordInput {
  /** An absolute URL, or a `URL` instance. */
  url: string | URL;
}

/** A `mime` record holding UTF-8 encoded JSON. */
export interface JsonRecordInput {
  /** Any JSON-serialisable value. */
  json: unknown;
}

/** A `mime` record with an explicit media type. */
export interface MimeRecordInput {
  /** The MIME type, e.g. `'image/png'`. */
  mediaType: string;
  /** The payload: bytes, an `ArrayBuffer`, or a string (encoded as UTF-8). */
  data: string | ArrayBuffer | ArrayBufferView;
}

/** One record's worth of input, in any of the accepted shapes. */
export type WritableRecord =
  | string
  | URL
  | TextRecordInput
  | UrlRecordInput
  | JsonRecordInput
  | MimeRecordInput;

/** Anything {@link toNdefMessage} accepts: one record, or an array of them. */
export type WritableMessage = WritableRecord | WritableRecord[];

/** A normalised record ready to hand to `NDEFReader.write()`. */
export interface NdefRecordInit {
  /** The NDEF record type. */
  recordType: 'text' | 'url' | 'mime';
  /** MIME type, present only on `'mime'` records. */
  mediaType?: string;
  /** Language tag, present only on `'text'` records that declared one. */
  lang?: string;
  /** Encoding, present only on `'text'` records that declared one. */
  encoding?: string;
  /** The payload. */
  data: string | Uint8Array;
}

/** A normalised NDEF message ready to hand to `NDEFReader.write()`. */
export interface NdefMessageInit {
  /** The records to write, in order. */
  records: NdefRecordInit[];
}

/** Extra hints for {@link toNdefMessage}. */
export interface ToNdefMessageOptions {
  /** Force a bare string to become a `url` record instead of a `text` record. */
  as?: 'text' | 'url';
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function normaliseRecord(input: WritableRecord, options: ToNdefMessageOptions): NdefRecordInit {
  if (typeof input === 'string') {
    if (options.as === 'url') {
      if (!isAbsoluteHttpUrl(input)) {
        throw new NfcError(
          'invalid-message',
          `Cannot write "${input}" as a url record: it is not an absolute http(s) URL.`,
        );
      }
      return { recordType: 'url', data: input };
    }
    return { recordType: 'text', data: input };
  }

  if (typeof URL !== 'undefined' && input instanceof URL) {
    return { recordType: 'url', data: input.href };
  }

  if (input === null || typeof input !== 'object') {
    throw new NfcError(
      'invalid-message',
      `Unsupported record input of type ${typeof input}. Pass a string, a URL, or a record object.`,
    );
  }

  const candidate = input as Partial<TextRecordInput & UrlRecordInput & JsonRecordInput & MimeRecordInput>;

  if (typeof candidate.text === 'string') {
    const record: NdefRecordInit = { recordType: 'text', data: candidate.text };
    if (candidate.lang) record.lang = candidate.lang;
    if (candidate.encoding) record.encoding = candidate.encoding;
    return record;
  }

  if (candidate.url !== undefined) {
    const href =
      typeof URL !== 'undefined' && candidate.url instanceof URL
        ? candidate.url.href
        : String(candidate.url);
    if (!isAbsoluteHttpUrl(href)) {
      throw new NfcError(
        'invalid-message',
        `Cannot write "${href}" as a url record: it is not an absolute http(s) URL.`,
      );
    }
    return { recordType: 'url', data: href };
  }

  if ('json' in candidate) {
    let serialised: string;
    try {
      serialised = JSON.stringify(candidate.json) ?? 'null';
    } catch (err) {
      throw new NfcError('invalid-message', 'The json value could not be serialised.', err);
    }
    return { recordType: 'mime', mediaType: 'application/json', data: utf8(serialised) };
  }

  if (typeof candidate.mediaType === 'string' && candidate.data !== undefined) {
    const raw = candidate.data;
    let data: Uint8Array;
    if (typeof raw === 'string') data = utf8(raw);
    else if (raw instanceof ArrayBuffer) data = new Uint8Array(raw.slice(0));
    else if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView;
      data = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    } else {
      throw new NfcError(
        'invalid-message',
        'mediaType records need data as a string, ArrayBuffer or typed array.',
      );
    }
    return { recordType: 'mime', mediaType: candidate.mediaType, data };
  }

  throw new NfcError(
    'invalid-message',
    'Unrecognised record shape. Expected a string, a URL, { text }, { url }, { json } or { mediaType, data }.',
  );
}

/**
 * Normalise a forgiving input into the exact `{ records: [...] }` structure
 * `NDEFReader.write()` expects. Pure and DOM-free, so it is directly unit
 * testable.
 *
 * Accepted inputs:
 * - a `string` — becomes a `text` record (or a `url` record with `{ as: 'url' }`)
 * - a `URL` instance — becomes a `url` record
 * - `{ text, lang?, encoding? }`
 * - `{ url }`
 * - `{ json }` — becomes an `application/json` `mime` record, UTF-8 encoded
 * - `{ mediaType, data }`
 * - an array of any of the above — becomes a multi-record message
 *
 * @param input - The message to normalise.
 * @param options - Set `{ as: 'url' }` to read a bare string as a URL.
 * @throws {NfcError} with code `'invalid-message'` when a shape is unrecognised.
 */
export function toNdefMessage(
  input: WritableMessage,
  options: ToNdefMessageOptions = {},
): NdefMessageInit {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) {
    throw new NfcError('invalid-message', 'Cannot write an empty message: no records supplied.');
  }
  return { records: list.map((record) => normaliseRecord(record, options)) };
}

/* -------------------------------------------------------------------------- */
/* Scanning                                                                   */
/* -------------------------------------------------------------------------- */

/** Options for {@link scan}. */
export interface ScanOptions {
  /** Called once per tap, with the fully decoded tag. */
  onTag: (tag: NfcTag) => void;
  /** Called when the reader reports an unreadable tag or the scan fails to (re)start. */
  onError?: (err: NfcError) => void;
  /** Abort this signal to stop the scan, exactly like calling `stop()`. */
  signal?: AbortSignal;
  /**
   * Restart scanning when the page becomes visible again. Web NFC stops
   * delivering events while the document is hidden and never resumes by itself.
   * @defaultValue true
   */
  autoResume?: boolean;
  /**
   * Stop automatically after the first tag.
   * @defaultValue false
   */
  once?: boolean;
}

/** Options for {@link read}. */
export interface ReadOptions {
  /** Abort this signal to give up waiting. */
  signal?: AbortSignal;
  /**
   * Give up after this many milliseconds and reject with code `'timeout'`.
   * Omit to wait forever.
   */
  timeoutMs?: number;
  /** Called if the reader reports an error while waiting; the promise keeps waiting. */
  onError?: (err: NfcError) => void;
}

/** Options for {@link write}. */
export interface WriteOptions {
  /**
   * Overwrite an existing message on the tag.
   * @defaultValue true
   */
  overwrite?: boolean;
  /** Abort this signal to cancel the pending write. */
  signal?: AbortSignal;
  /**
   * Reject with code `'timeout'` if no tag is presented in time.
   * @defaultValue 15000
   */
  timeoutMs?: number;
  /** Read a bare string argument as a URL rather than text. */
  as?: 'text' | 'url';
}

/** Options for {@link makeReadOnly}. */
export interface MakeReadOnlyOptions {
  /** Abort this signal to cancel the pending operation. */
  signal?: AbortSignal;
  /**
   * Reject with code `'timeout'` if no tag is presented in time.
   * @defaultValue 15000
   */
  timeoutMs?: number;
}

/** The one live scan, if any. Web NFC allows exactly one at a time. */
let activeScan: NfcScan | null = null;

/**
 * The scan that is currently running, or `null`. Useful when a component tree
 * needs to know whether someone else already owns the reader.
 */
export function getActiveScan(): NfcScan | null {
  return activeScan;
}

/**
 * Start scanning for NFC tags. Resolves once scanning has *started*; tags then
 * arrive through `onTag` until you call `stop()`.
 *
 * Notes that matter:
 * - The underlying `reader.scan()` promise never resolves per-tag and has no
 *   stop method. This function owns an internal `AbortController`; `stop()`
 *   aborts it, and a caller-supplied `signal` is chained to it.
 * - Only one scan may run at a time. Calling `scan()` while one is active
 *   rejects with code `'already-scanning'` — call `stop()` on the first handle,
 *   or read {@link getActiveScan}, rather than racing the platform's
 *   `InvalidStateError`.
 * - The first call must happen inside a user gesture (a click or tap handler),
 *   otherwise the permission prompt is suppressed and you get
 *   `'permission-denied'`.
 *
 * @param options - See {@link ScanOptions}. `onTag` is required.
 * @returns A handle exposing `stop()` and `active`.
 * @throws {NfcError} `'unsupported'`, `'insecure-context'`, `'already-scanning'`,
 *   `'permission-denied'` or `'no-hardware'`.
 */
export async function scan(options: ScanOptions): Promise<NfcScan> {
  if (!options || typeof options.onTag !== 'function') {
    throw new NfcError('invalid-message', 'scan() requires an onTag callback.');
  }
  const Reader = assertSupported();

  if (activeScan !== null && activeScan.active) {
    throw new NfcError('already-scanning', MESSAGES['already-scanning']);
  }

  const autoResume = options.autoResume !== false;
  const once = options.once === true;

  let controller = new AbortController();
  let stopped = false;
  let reader: NDEFReaderLike | null = null;
  let onVisibility: (() => void) | null = null;

  const handle: NfcScan = {
    stop() {
      if (stopped) return;
      stopped = true;
      if (onVisibility && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
        onVisibility = null;
      }
      if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
      if (reader) reader.removeEventListener('reading', onReading as (e: never) => void);
      controller.abort();
      reader = null;
      if (activeScan === handle) activeScan = null;
    },
    get active() {
      return !stopped;
    },
  };

  function onExternalAbort() {
    handle.stop();
  }

  function onReading(event: NDEFReadingEventLike) {
    if (stopped) return;
    let tag: NfcTag;
    try {
      tag = toNfcTag(event.message, event.serialNumber ?? null);
    } catch (err) {
      options.onError?.(toNfcError(err));
      return;
    }
    if (once) handle.stop();
    try {
      options.onTag(tag);
    } catch (err) {
      options.onError?.(toNfcError(err));
    }
  }

  function onReadingError() {
    options.onError?.(new NfcError('read-failed', MESSAGES['read-failed']));
  }

  async function startReader(): Promise<void> {
    const instance = new Reader();
    instance.addEventListener('reading', onReading as (e: never) => void);
    instance.addEventListener('readingerror', onReadingError as (e: never) => void);
    reader = instance;
    await instance.scan({ signal: controller.signal });
  }

  if (options.signal) {
    if (options.signal.aborted) {
      throw new NfcError('aborted', MESSAGES['aborted']);
    }
    options.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    await startReader();
  } catch (err) {
    handle.stop();
    throw toNfcError(err);
  }

  if (autoResume && typeof document !== 'undefined') {
    onVisibility = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      // The old controller's reader is dead once the page was hidden; start a
      // fresh one behind the same handle so `stop()` still works.
      controller.abort();
      controller = new AbortController();
      void startReader().catch((err) => {
        options.onError?.(toNfcError(err));
      });
    };
    document.addEventListener('visibilitychange', onVisibility);
  }

  activeScan = handle;
  return handle;
}

/**
 * Wait for a single tap, then stop scanning.
 *
 * @param options - See {@link ReadOptions}.
 * @returns The decoded tag.
 * @throws {NfcError} `'timeout'` when `timeoutMs` elapses, `'aborted'` when the
 *   signal aborts, plus every error {@link scan} can throw.
 */
export function read(options: ReadOptions = {}): Promise<NfcTag> {
  return new Promise<NfcTag>((resolve, reject) => {
    let settled = false;
    let handle: NfcScan | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      handle?.stop();
    };

    const fail = (err: NfcError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    function onAbort() {
      fail(new NfcError('aborted', MESSAGES['aborted']));
    }

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new NfcError('aborted', MESSAGES['aborted']));
        return;
      }
      options.signal.addEventListener('abort', onAbort);
    }

    if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        fail(new NfcError('timeout', MESSAGES['timeout']));
      }, options.timeoutMs);
    }

    scan({
      once: true,
      onError: options.onError,
      onTag: (tag) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(tag);
      },
    })
      .then((scanHandle) => {
        handle = scanHandle;
        // A tap that arrived before this resolved has already cleaned up.
        if (settled) scanHandle.stop();
      })
      .catch((err: unknown) => {
        fail(toNfcError(err));
      });
  });
}

/** Runs a one-shot NFC operation with a timeout and abort chaining. */
async function withTimeout(
  run: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) throw new NfcError('aborted', MESSAGES['aborted']);
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  // Race the operation against our own abort: the platform is *supposed* to
  // reject a pending write when the signal aborts, but racing means a timeout
  // always settles the promise even if it does not.
  let rejectAborted: (reason: NfcError) => void = () => {};
  const onAbort = () => {
    rejectAborted(
      timedOut
        ? new NfcError('timeout', MESSAGES['timeout'])
        : new NfcError('aborted', MESSAGES['aborted']),
    );
  };
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  controller.signal.addEventListener('abort', onAbort);
  // The loser of the race must never surface as an unhandled rejection.
  aborted.catch(() => {});

  try {
    await Promise.race([run(controller.signal), aborted]);
  } catch (err) {
    if (timedOut) {
      if (err instanceof NfcError && err.code === 'timeout') throw err;
      throw new NfcError('timeout', MESSAGES['timeout'], err);
    }
    throw toNfcError(err);
  } finally {
    if (timer !== null) clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Write an NDEF message to the next tag presented.
 *
 * The raw write promise hangs until a tag arrives, so this defaults to a
 * 15 second timeout. On timeout the internal controller is aborted and the
 * promise rejects with code `'timeout'`.
 *
 * Must be called from a user gesture the first time, so the permission prompt
 * can be shown.
 *
 * @param message - Anything {@link toNdefMessage} accepts.
 * @param options - See {@link WriteOptions}.
 * @throws {NfcError} `'invalid-message'`, `'tag-moved'` (the tag left the field
 *   mid-write — the classic failure), `'timeout'`, `'permission-denied'`,
 *   `'no-hardware'`, `'unsupported'` or `'insecure-context'`.
 */
export async function write(
  message: WritableMessage,
  options: WriteOptions = {},
): Promise<void> {
  const Reader = assertSupported();
  const payload = toNdefMessage(message, options.as ? { as: options.as } : {});
  const overwrite = options.overwrite !== false;
  const timeoutMs = options.timeoutMs === undefined ? 15000 : options.timeoutMs;

  const reader = new Reader();
  await withTimeout(
    (signal) => reader.write(payload, { overwrite, signal }),
    timeoutMs,
    options.signal,
  );
}

/**
 * Permanently lock the next tag presented so it can never be written again.
 *
 * **This is irreversible.** There is no unlock. Confirm with the user first.
 *
 * @param options - See {@link MakeReadOnlyOptions}.
 * @throws {NfcError} the same codes as {@link write}.
 */
export async function makeReadOnly(options: MakeReadOnlyOptions = {}): Promise<void> {
  const Reader = assertSupported();
  const timeoutMs = options.timeoutMs === undefined ? 15000 : options.timeoutMs;
  const reader = new Reader();
  await withTimeout(
    (signal) => reader.makeReadOnly({ signal }),
    timeoutMs,
    options.signal,
  );
}

/* -------------------------------------------------------------------------- */
/* Default export                                                             */
/* -------------------------------------------------------------------------- */

/** Every named export, gathered so `NfcTap.scan(...)` reads naturally from the CDN build. */
const Nfc = {
  isSupported,
  scan,
  read,
  write,
  makeReadOnly,
  decodeMessage,
  toNfcTag,
  toNdefMessage,
  toNfcError,
  getActiveScan,
  NfcError,
};

export default Nfc;
