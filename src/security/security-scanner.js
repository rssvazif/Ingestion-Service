/**
 * Phase 3 placeholder.
 *
 * A future SecurityScanner will sit between classification and parsing. It will
 * receive each classified file's content and decide between ALLOW, BLOCK, or
 * REDACT. This module exposes the contract only — no implementation.
 *
 * Wiring rules for future implementations:
 *   - Register as a singleton in the orchestrator before parsing.
 *   - A BLOCK decision must remove the file from the processed stream.
 *   - A REDACT decision must rewrite the buffer before parsing.
 *   - An ALLOW decision is the default pass-through.
 */

/** @typedef {('ALLOW' | 'BLOCK' | 'REDACT')} SecurityDecision */

/**
 * @typedef {object} SecurityScanInput
 * @property {string} filePath
 * @property {Buffer} content
 * @property {string} [language]
 */

/**
 * @typedef {object} SecurityScanOutput
 * @property {SecurityDecision} decision
 * @property {string} [reason]
 * @property {Buffer} [redactedContent]
 */

/**
 * @typedef {object} SecurityScanner
 * @property {string} name
 * @property {(input: SecurityScanInput) => Promise<SecurityScanOutput>} scan
 */

/**
 * No-op scanner that always returns ALLOW. Used by default until a real
 * implementation is plugged in.
 */
export class AllowAllSecurityScanner {
  /** @type {string} */
  name = 'AllowAll';

  /** @param {SecurityScanInput} _input */
  async scan(_input) {
    return { decision: 'ALLOW' };
  }
}

/** @returns {SecurityScanner} */
export function defaultSecurityScanner() {
  return new AllowAllSecurityScanner();
}