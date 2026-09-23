export interface NormalizedTrigger {
  projectId: string;
  projectName?: string;
}

export interface TriggerParseErrorContext {
  issues?: string[];
  reason?: string;
}
