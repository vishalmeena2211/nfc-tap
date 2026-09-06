/**
 * React adapter for `nfc-tap`.
 *
 * Hooks only — no JSX, so this file needs no JSX runtime and `react` stays an
 * optional peer dependency.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isSupported,
  scan,
  toNfcError,
  write as writeTag,
  type NfcError,
  type NfcScan,
  type NfcTag,
  type WritableMessage,
  type WriteOptions,
} from './index';

/** Options for {@link useNfc}. */
export interface UseNfcOptions {
  /**
   * Start scanning as soon as the component mounts. Leave this off unless you
   * know permission was already granted: the first scan needs a user gesture,
   * and a mount is not one.
   * @defaultValue false
   */
  autoStart?: boolean;
  /** Called for every tap, in addition to `lastTag` being updated. */
  onTag?: (tag: NfcTag) => void;
  /** Called for every normalised error, in addition to `error` being set. */
  onError?: (err: NfcError) => void;
  /**
   * Restart scanning when the page becomes visible again.
   * @defaultValue true
   */
  autoResume?: boolean;
}

/** What {@link useNfc} returns. */
export interface UseNfcResult {
  /** Whether Web NFC is usable here: `NDEFReader` present and a secure context. `false` during SSR. */
  supported: boolean;
  /** Whether a scan is currently running. */
  scanning: boolean;
  /** The most recent tap, or `null`. */
  lastTag: NfcTag | null;
  /** The most recent normalised error, or `null`. Cleared when a scan starts. */
  error: NfcError | null;
  /** Start scanning. Wire this to an `onClick` so the permission prompt has a user gesture. */
  start: () => Promise<void>;
  /** Stop scanning. Safe to call when nothing is running. */
  stop: () => void;
  /** Write a message to the next tag. Rejects with a typed `NfcError`. */
  write: (message: WritableMessage, options?: WriteOptions) => Promise<void>;
}

/**
 * Scan for NFC tags from a React component.
 *
 * The scan is torn down on unmount, so no reader or `visibilitychange`
 * listener is ever left behind.
 *
 * @example
 * ```tsx
 * const { supported, scanning, lastTag, error, start, stop } = useNfc();
 * if (!supported) return <p>NFC needs Chrome on Android over HTTPS.</p>;
 * return (
 *   <button onClick={scanning ? stop : start}>
 *     {scanning ? 'Stop' : 'Scan'} {lastTag?.text}
 *   </button>
 * );
 * ```
 */
export function useNfc(options: UseNfcOptions = {}): UseNfcResult {
  const [supported, setSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastTag, setLastTag] = useState<NfcTag | null>(null);
  const [error, setError] = useState<NfcError | null>(null);

  const scanRef = useRef<NfcScan | null>(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Browser-only check, deliberately after the first render so server and
  // client markup agree.
  useEffect(() => {
    setSupported(isSupported());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scanRef.current?.stop();
      scanRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    scanRef.current?.stop();
    scanRef.current = null;
    if (mountedRef.current) setScanning(false);
  }, []);

  const start = useCallback(async () => {
    if (scanRef.current?.active || startingRef.current) return;
    startingRef.current = true;
    setError(null);
    try {
      const handle = await scan({
        autoResume: optionsRef.current.autoResume !== false,
        onTag: (tag) => {
          if (mountedRef.current) setLastTag(tag);
          optionsRef.current.onTag?.(tag);
        },
        onError: (err) => {
          if (mountedRef.current) setError(err);
          optionsRef.current.onError?.(err);
        },
      });
      if (!mountedRef.current) {
        handle.stop();
        return;
      }
      scanRef.current = handle;
      setScanning(true);
    } catch (err) {
      const normalised = toNfcError(err);
      if (mountedRef.current) {
        setError(normalised);
        setScanning(false);
      }
      optionsRef.current.onError?.(normalised);
    } finally {
      startingRef.current = false;
    }
  }, []);

  const write = useCallback(
    async (message: WritableMessage, writeOptions?: WriteOptions) => {
      try {
        await writeTag(message, writeOptions);
      } catch (err) {
        const normalised = toNfcError(err);
        if (mountedRef.current) setError(normalised);
        optionsRef.current.onError?.(normalised);
        throw normalised;
      }
    },
    [],
  );

  const autoStart = options.autoStart === true;
  useEffect(() => {
    if (!autoStart || !supported) return;
    void start();
  }, [autoStart, supported, start]);

  return { supported, scanning, lastTag, error, start, stop, write };
}

export default useNfc;
