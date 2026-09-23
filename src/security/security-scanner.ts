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

export type SecurityDecision = 'ALLOW' | 'BLOCK' | 'REDACT';

export interface SecurityScanInput {
  filePath: string;
  content: Buffer;
  language?: string;
}

export interface SecurityScanOutput {
  decision: SecurityDecision;
  reason?: string;
  redactedContent?: Buffer;
}

export interface SecurityScanner {
  readonly name: string;
  scan(input: SecurityScanInput): Promise<SecurityScanOutput>;
}

/**
 * No-op scanner that always returns ALLOW. Used by default until a real
 * implementation is plugged in.
 */
export class AllowAllSecurityScanner implements SecurityScanner {
  public readonly name = 'AllowAll';

  async scan(_input: SecurityScanInput): Promise<SecurityScanOutput> {
    return { decision: 'ALLOW' };
  }
}

export function defaultSecurityScanner(): SecurityScanner {
  return new AllowAllSecurityScanner();
}
