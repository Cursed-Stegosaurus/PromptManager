// Working database module for Prompt Library
console.log('Database module loaded');

class PromptDatabase {
  constructor() {
    this.dbName = 'prompt-library';
    this.dbVersion = 1;
    this.storeName = 'prompts';
    this.metaStoreName = 'meta';
  }

  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create prompts store
        if (!db.objectStoreNames.contains(this.storeName)) {
          const promptStore = db.createObjectStore(this.storeName, { keyPath: 'id' });
          promptStore.createIndex('by_deletedAt', 'deletedAt', { unique: false });
          promptStore.createIndex('by_favorite', 'favorite', { unique: false });
          promptStore.createIndex('by_category', 'category', { unique: false });
          promptStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
        }
        
        // Create meta store
        if (!db.objectStoreNames.contains(this.metaStoreName)) {
          db.createObjectStore(this.metaStoreName, { keyPath: 'key' });
        }
      };
    });
  }

  async addPrompt(prompt) {
    const db = await this.openDB();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    
    // Ensure prompt has required fields
    const promptToSave = {
      id: prompt.id || crypto.randomUUID(),
      title: prompt.title || '',
      body: prompt.body || '',
      tags: prompt.tags || [],
      category: prompt.category || 'general',
      favorite: prompt.favorite || false,
      hidden: prompt.hidden || false,
      deletedAt: null,
      createdAt: prompt.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: prompt.version || 1
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(promptToSave);
      request.onsuccess = () => resolve(promptToSave);
      request.onerror = () => reject(request.error);
    });
  }

  async getPrompt(id) {
    const db = await this.openDB();
    const transaction = db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);
    
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllPrompts(includeDeleted = false) {
    const db = await this.openDB();
    const transaction = db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);
    
    return new Promise((resolve, reject) => {
      const prompts = [];
      const request = store.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const prompt = cursor.value;
          if (includeDeleted || !prompt.deletedAt) {
            prompts.push(prompt);
          }
          cursor.continue();
        } else {
          resolve(prompts);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async updatePrompt(id, updates) {
    const prompt = await this.getPrompt(id);
    if (!prompt) throw new Error('Prompt not found');
    
    const updatedPrompt = { ...prompt, ...updates, updatedAt: new Date().toISOString() };
    return this.addPrompt(updatedPrompt);
  }

  async deletePrompt(id, softDelete = true) {
    if (softDelete) {
      return this.updatePrompt(id, { deletedAt: new Date().toISOString() });
    } else {
      const db = await this.openDB();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }

  async toggleFavorite(id) {
    const prompt = await this.getPrompt(id);
    if (!prompt) throw new Error('Prompt not found');
    
    return this.updatePrompt(id, { favorite: !prompt.favorite });
  }

  async toggleHidden(id) {
    const prompt = await this.getPrompt(id);
    if (!prompt) throw new Error('Prompt not found');
    
    return this.updatePrompt(id, { hidden: !prompt.hidden });
  }

  async searchPrompts(query, filters = {}) {
    const allPrompts = await this.getAllPrompts();
    let results = allPrompts;
    
    // Apply filters
    if (filters.favorite !== undefined) {
      results = results.filter(p => p.favorite === filters.favorite);
    }
    if (filters.hidden !== undefined) {
      results = results.filter(p => p.hidden === filters.hidden);
    }
    if (filters.category) {
      results = results.filter(p => p.category === filters.category);
    }
    
    // Apply search query
    if (query) {
      const searchTerms = query.toLowerCase().split(/\s+/);
      results = results.filter(prompt => {
        const searchableText = `${prompt.title} ${prompt.body} ${prompt.tags.join(' ')}`.toLowerCase();
        return searchTerms.every(term => searchableText.includes(term));
      });
    }
    
    // Sort by relevance/date
    results.sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    
    return results;
  }

  async getMeta(key) {
    const db = await this.openDB();
    const transaction = db.transaction([this.metaStoreName], 'readonly');
    const store = transaction.objectStore(this.metaStoreName);
    
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }

  async setMeta(key, value) {
    const db = await this.openDB();
    const transaction = db.transaction([this.metaStoreName], 'readwrite');
    const store = transaction.objectStore(this.metaStoreName);
    
    return new Promise((resolve, reject) => {
      const request = store.put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async purgeDeletedPrompts() {
    const db = await this.openDB();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    return new Promise((resolve, reject) => {
      const request = store.openCursor();
      let purgedCount = 0;
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const prompt = cursor.value;
          if (prompt.deletedAt && new Date(prompt.deletedAt) < thirtyDaysAgo) {
            cursor.delete();
            purgedCount++;
          }
          cursor.continue();
        } else {
          resolve(purgedCount);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async exportData() {
    const prompts = await this.getAllPrompts();
    const meta = await this.getAllMeta();
    
    return {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      prompts,
      meta
    };
  }

  async importData(data) {
    if (data.prompts) {
      for (const prompt of data.prompts) {
        await this.addPrompt(prompt);
      }
    }
    
    if (data.meta) {
      for (const metaItem of data.meta) {
        await this.setMeta(metaItem.key, metaItem.value);
      }
    }
  }

  async getAllMeta() {
    const db = await this.openDB();
    const transaction = db.transaction([this.metaStoreName], 'readonly');
    const store = transaction.objectStore(this.metaStoreName);
    
    return new Promise((resolve, reject) => {
      const meta = [];
      const request = store.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          meta.push(cursor.value);
          cursor.continue();
        } else {
          resolve(meta);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }
}

// Create and export database instance
const promptDB = new PromptDatabase();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = promptDB;
} else {
  // Browser/Chrome extension context
  window.promptDB = promptDB;
}
