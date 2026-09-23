export type TriggerAction = 'merge' | 'approved';

export interface NormalizedTrigger {
  action: TriggerAction;
  projectId: string;
  branch: string;
  sourceBranch?: string;
  commit?: string;
  mergeRequestIid?: number;
  mergeRequestUrl?: string;
  version?: string;
  forceFull?: boolean;
}

export interface TriggerParseErrorContext {
  issues?: string[];
  reason?: string;
}
