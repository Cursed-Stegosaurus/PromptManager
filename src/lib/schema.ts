export type Source = "starter" | "user" | "shared";

// Migration support for backward compatibility
export interface MigrationSupport {
  readonly legacySourceTypes: readonly ["seed"];
  readonly currentSourceTypes: readonly Source[];
  
  isLegacySource(source: string): source is "seed";
  migrateSource(source: string): Source;
}

export const sourceMigration: MigrationSupport = {
  legacySourceTypes: ["seed"] as const,
  currentSourceTypes: ["starter", "user", "shared"] as const,
  
  isLegacySource(source: string): source is "seed" {
    return source === "seed";
  },
  
  migrateSource(source: string): Source {
    if (this.isLegacySource(source)) return "starter";
    return source as Source;
  }
};

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

export interface PromptUsage {
  promptId: string;
  usageCount: number;
  lastUsed: string;
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
  analytics: {
    totalPromptsUsed: number;
    topUsedPrompts: PromptUsage[];
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
