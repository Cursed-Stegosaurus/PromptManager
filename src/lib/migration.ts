export interface MigrationState {
  version: string;
  timestamp: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  rollbackVersion?: string;
  dataBackup?: string;
}

export interface MigrationResult {
  success: boolean;
  migratedCount: number;
  errors: string[];
  backupCreated: boolean;
}

export class MigrationManager {
  private static instance: MigrationManager;
  
  static getInstance(): MigrationManager {
    if (!MigrationManager.instance) {
      MigrationManager.instance = new MigrationManager();
    }
    return MigrationManager.instance;
  }
  
  async migrateSeedToStarter(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      migratedCount: 0,
      errors: [],
      backupCreated: false
    };
    
    try {
      console.log('Starting migration from seed to starter...');
      
      // 1. Create backup
      result.backupCreated = await this.createBackup();
      if (!result.backupCreated) {
        throw new Error('Failed to create backup');
      }
      
      // 2. Update existing data
      result.migratedCount = await this.updateExistingData();
      
      // 3. Update schema and metadata
      await this.updateSchema();
      
      // 4. Validate migration
      await this.validateMigration();
      
      result.success = true;
      console.log(`Migration completed successfully. Migrated ${result.migratedCount} prompts.`);
      
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      console.error('Migration failed:', error);
      
      // Attempt rollback
      try {
        await this.rollback();
        console.log('Rollback completed successfully');
      } catch (rollbackError) {
        result.errors.push(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown error'}`);
        console.error('Rollback failed:', rollbackError);
      }
    }
    
    return result;
  }
  
  private async createBackup(): Promise<boolean> {
    try {
      const { openDb, listPrompts } = await import('./db.js');
      const db = await openDb();
      const prompts = await listPrompts(true);
      
      const backup = {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        prompts: prompts
      };
      
      // Store backup in metadata
      const { putMeta } = await import('./db.js');
      await putMeta('migrationBackup', backup);
      
      console.log(`Backup created with ${prompts.length} prompts`);
      return true;
    } catch (error) {
      console.error('Failed to create backup:', error);
      return false;
    }
  }
  
  private async updateExistingData(): Promise<number> {
    try {
      const { openDb, listPrompts, putPrompt } = await import('./db.js');
      const db = await openDb();
      const prompts = await listPrompts(true);
      
      let migratedCount = 0;
      
      for (const prompt of prompts) {
        if (prompt.source === 'seed') {
          const updatedPrompt = { ...prompt, source: 'starter' as const };
          await putPrompt(updatedPrompt);
          migratedCount++;
        }
      }
      
      console.log(`Updated ${migratedCount} prompts from seed to starter`);
      return migratedCount;
    } catch (error) {
      console.error('Failed to update existing data:', error);
      throw error;
    }
  }
  
  private async updateSchema(): Promise<void> {
    try {
      const { putMeta } = await import('./db.js');
      
      // Update migration state
      await putMeta('migrationCompleted', true);
      await putMeta('migrationTimestamp', new Date().toISOString());
      await putMeta('migrationVersion', '2.0.0');
      
      console.log('Schema updated successfully');
    } catch (error) {
      console.error('Failed to update schema:', error);
      throw error;
    }
  }
  
  private async validateMigration(): Promise<void> {
    try {
      const { listPrompts } = await import('./db.js');
      const prompts = await listPrompts(true);
      
      // Check that no prompts still have 'seed' source
      const remainingSeedPrompts = prompts.filter(p => p.source === 'seed');
      if (remainingSeedPrompts.length > 0) {
        throw new Error(`Migration validation failed: ${remainingSeedPrompts.length} prompts still have 'seed' source`);
      }
      
      console.log('Migration validation passed');
    } catch (error) {
      console.error('Migration validation failed:', error);
      throw error;
    }
  }
  
  private async rollback(): Promise<void> {
    try {
      const { putMeta, getMeta } = await import('./db.js');
      
      // Get backup
      const backup = await getMeta('migrationBackup');
      if (!backup) {
        throw new Error('No backup found for rollback');
      }
      
      // Restore prompts from backup
      const { putPrompt } = await import('./db.js');
      for (const prompt of backup.prompts) {
        await putPrompt(prompt);
      }
      
      // Reset migration state
      await putMeta('migrationCompleted', false);
      await putMeta('migrationTimestamp', '');
      await putMeta('migrationVersion', '');
      
      console.log('Rollback completed successfully');
    } catch (error) {
      console.error('Rollback failed:', error);
      throw error;
    }
  }
  
  async checkMigrationStatus(): Promise<MigrationState> {
    try {
      const { getMeta } = await import('./db.js');
      
      const completed = await getMeta<boolean>('migrationCompleted');
      const timestamp = await getMeta<string>('migrationTimestamp');
      const version = await getMeta<string>('migrationVersion');
      
      return {
        version: version || '1.0.0',
        timestamp: timestamp || '',
        status: completed ? 'completed' : 'pending'
      };
    } catch (error) {
      console.error('Failed to check migration status:', error);
      return {
        version: '1.0.0',
        timestamp: '',
        status: 'failed'
      };
    }
  }
}
