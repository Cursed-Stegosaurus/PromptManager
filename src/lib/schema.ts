export type Source = "seed" | "user" | "shared";

export interface Prompt {
  id: string;
  title: string;
  body: string;
  tags: string[];
  variables?: Array<{ name: string; label?: string; required?: boolean; defaultValue?: string }>;
  department?: string;
  favorite?: boolean;
  hidden?: boolean;
  source: Source;
  originId?: string;
  deprecated?: boolean;
  hasUpstreamUpdate?: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface LibraryState {
  schemaVersion: "1.0.0";
  prompts: Prompt[];
  lastUsedPromptId?: string;
  userSettings: {
    theme: "system" | "light" | "dark";
    showHidden: boolean;
    insertionStrategy: "direct" | "clipboard" | "ask";
    telemetryEnabled: boolean;
    recycleAutoPurgeDays: 30;
    encryptionEnabled?: boolean;
    saltB64?: string;
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
