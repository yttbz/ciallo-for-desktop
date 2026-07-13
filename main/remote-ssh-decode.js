/**
 * main/remote-ssh-decode.js — Stderr decoding (UTF-8 + GBK fallback)
 *
 * SSH stderr output may come in various encodings depending on the remote
 * server's locale. This module attempts UTF-8 first, then falls back to
 * GBK/GB2312 (common on Chinese servers) or Latin-1 as a last resort.
 *
 * @module main/remote-ssh-decode
 */

'use strict';

// ─── Iconv availability ───────────────────────────────────────────────────────

/** @type {boolean} Whether the `iconv-lite` package is available. */
var hasIconv = false;
try {
  require('iconv-lite');
  hasIconv = true;
} catch (_) {
  hasIconv = false;
}

/** @type {object|null} Lazily-loaded iconv-lite instance */
var iconv = null;

/**
 * Lazily load iconv-lite.
 *
 * @returns {object|null} iconv-lite module or null if unavailable
 */
function getIconv() {
  if (iconv) return iconv;
  if (!hasIconv) return null;
  try {
    iconv = require('iconv-lite');
    return iconv;
  } catch (_) {
    hasIconv = false;
    return null;
  }
}

// ─── Detectors ────────────────────────────────────────────────────────────────

/**
 * Check if a buffer contains valid UTF-8 data.
 *
 * Based on the UTF-8 encoding rules:
 *   - 1-byte: 0xxxxxxx (0x00-0x7F)
 *   - 2-byte: 110xxxxx 10xxxxxx (0xC2-0xDF, 0x80-0xBF)
 *   - 3-byte: 1110xxxx 10xxxxxx 10xxxxxx (0xE0-0xEF, 0x80-0xBF, 0x80-0xBF)
 *   - 4-byte: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx (0xF0-0xF4, 0x80-0xBF, ...)
 *
 * @param {Buffer} buf - Raw buffer to test
 * @returns {boolean} true if the buffer decodes cleanly as UTF-8
 */
function isValidUtf8(buf) {
  if (!Buffer.isBuffer(buf)) {
    buf = Buffer.from(String(buf));
  }

  var i = 0;
  var len = buf.length;

  while (i < len) {
    var byte1 = buf[i];

    if (byte1 <= 0x7F) {
      // 1-byte sequence
      i += 1;
    } else if (byte1 >= 0xC2 && byte1 <= 0xDF) {
      // 2-byte sequence
      if (i + 1 >= len) return false;
      var byte2 = buf[i + 1];
      if (byte2 < 0x80 || byte2 > 0xBF) return false;
      i += 2;
    } else if (byte1 >= 0xE0 && byte1 <= 0xEF) {
      // 3-byte sequence
      if (i + 2 >= len) return false;
      var b2 = buf[i + 1];
      var b3 = buf[i + 2];
      if (b2 < 0x80 || b2 > 0xBF) return false;
      if (b3 < 0x80 || b3 > 0xBF) return false;
      // Overlong and surrogate checks
      if (byte1 === 0xE0 && b2 < 0xA0) return false;
      if (byte1 === 0xED && b2 > 0x9F) return false;
      i += 3;
    } else if (byte1 >= 0xF0 && byte1 <= 0xF4) {
      // 4-byte sequence
      if (i + 3 >= len) return false;
      var b2_4 = buf[i + 1];
      var b3_4 = buf[i + 2];
      var b4_4 = buf[i + 3];
      if (b2_4 < 0x80 || b2_4 > 0xBF) return false;
      if (b3_4 < 0x80 || b3_4 > 0xBF) return false;
      if (b4_4 < 0x80 || b4_4 > 0xBF) return false;
      // Overlong check
      if (byte1 === 0xF0 && b2_4 < 0x90) return false;
      if (byte1 === 0xF4 && b2_4 > 0x8F) return false;
      i += 4;
    } else {
      // Continuation byte or invalid lead byte
      return false;
    }
  }

  return true;
}

/**
 * Heuristically detect whether a buffer is GBK-encoded Chinese text.
 *
 * GBK uses a lead byte in 0x81-0xFE range with a trail byte in 0x40-0xFE
 * (except 0x7F). This check is conservative: it only returns true if a
 * significant fraction of the buffer reads as GBK byte pairs.
 *
 * @param {Buffer} buf - Raw buffer to test
 * @returns {boolean} true if the buffer likely contains GBK text
 */
function isLikelyGbk(buf) {
  if (!Buffer.isBuffer(buf)) {
    buf = Buffer.from(String(buf));
  }
  if (buf.length < 2) return false;

  var gbkPairs = 0;
  var totalPairs = 0;
  var i = 0;
  var len = buf.length;

  while (i < len - 1) {
    var lead = buf[i];
    var trail = buf[i + 1];

    // ASCII range
    if (lead <= 0x7F) {
      i += 1;
      continue;
    }

    // Check if this forms a valid GBK double-byte pair
    totalPairs++;
    if (
      lead >= 0x81 && lead <= 0xFE &&
      trail >= 0x40 && trail <= 0xFE && trail !== 0x7F
    ) {
      gbkPairs++;
      i += 2;
    } else {
      i += 1;
    }
  }

  // At least 50% of non-ASCII byte pairs should match GBK
  if (totalPairs === 0) return false;
  return (gbkPairs / totalPairs) >= 0.5;
}

// ─── Decoding ─────────────────────────────────────────────────────────────────

/**
 * Decode a buffer or string to a UTF-8 JavaScript string.
 *
 * Strategy:
 *   1. If input is a string, return as-is (already decoded).
 *   2. If input is a Buffer, try UTF-8 first.
 *   3. If UTF-8 fails (invalid sequences), try GBK via iconv-lite (fallback).
 *   4. If iconv-lite is unavailable, use Latin-1 (lossy but safe).
 *
 * @param {Buffer|string} input - Raw data from SSH stderr
 * @returns {string} Decoded UTF-8 string
 */
function decodeStderr(input) {
  if (typeof input === 'string') {
    return input;
  }
  if (!Buffer.isBuffer(input)) {
    return String(input);
  }
  if (input.length === 0) {
    return '';
  }

  // Try UTF-8
  if (isValidUtf8(input)) {
    return input.toString('utf-8');
  }

  // Try GBK via iconv-lite
  if (isLikelyGbk(input)) {
    var ic = getIconv();
    if (ic && ic.decode) {
      try {
        return ic.decode(input, 'GBK');
      } catch (_) {
        // Fall through to Latin-1
      }
    }
  }

  // Last resort: Latin-1 (never fails, every byte maps to same Unicode codepoint)
  return input.toString('latin1');
}

/**
 * Decode a stderr buffer line-by-line.
 *
 * Handles partial lines that may span multiple data events by buffering
 * trailing incomplete data.
 *
 * @returns {object} A decoder instance with:
 *   - `write(data)`: Feed new buffer data, returns array of complete lines
 *   - `flush()`: Return any remaining buffered data as a single line
 */
function createLineDecoder() {
  /** @type {Buffer|null} */
  var buffer = null;

  /**
   * Feed data into the decoder.
   *
   * @param {Buffer|string} data - Incoming chunk
   * @returns {string[]} Array of complete decoded lines
   */
  function write(data) {
    var buf;
    if (Buffer.isBuffer(data)) {
      buf = data;
    } else if (typeof data === 'string') {
      buf = Buffer.from(data, 'utf-8');
    } else {
      return [];
    }

    if (buffer) {
      buf = Buffer.concat([buffer, buf]);
    }

    // Split on newlines
    var lines = [];
    var start = 0;
    var i = 0;

    while (i < buf.length) {
      if (buf[i] === 0x0A) {
        // \n
        var lineBuf = buf.slice(start, i);
        lines.push(decodeStderr(lineBuf));
        i++;
        start = i;
      } else if (buf[i] === 0x0D) {
        // \r — check for \r\n
        if (i + 1 < buf.length && buf[i + 1] === 0x0A) {
          var lineBuf2 = buf.slice(start, i);
          lines.push(decodeStderr(lineBuf2));
          i += 2;
          start = i;
        } else {
          // Standalone \r — treat as line break
          var lineBuf3 = buf.slice(start, i);
          lines.push(decodeStderr(lineBuf3));
          i++;
          start = i;
        }
      } else {
        i++;
      }
    }

    // Keep remaining partial line in buffer
    if (start < buf.length) {
      buffer = buf.slice(start);
    } else {
      buffer = null;
    }

    return lines;
  }

  /**
   * Flush any remaining buffered data.
   *
   * @returns {string} Decoded remaining data, or empty string
   */
  function flush() {
    if (!buffer || buffer.length === 0) {
      buffer = null;
      return '';
    }
    var result = decodeStderr(buffer);
    buffer = null;
    return result;
  }

  return { write: write, flush: flush };
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  isValidUtf8,
  isLikelyGbk,
  decodeStderr,
  createLineDecoder,
};
