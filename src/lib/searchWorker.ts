// Search worker for smooth performance with large prompt lists
interface SearchQuery {
  q: string;
  showHidden: boolean;
  includeBin: boolean;
  sortBy: 'relevance' | 'title' | 'createdAt' | 'updatedAt' | 'favorite';
  sortOrder: 'asc' | 'desc';
}

interface SearchResult {
  id: string;
  title: string;
  body: string;
  tags: string[];
  favorite: boolean;
  hidden: boolean;
  deletedAt?: string;
  source: string;
  relevance: number;
}

// Light filter logic with tag:, fav:true, hidden:true, bin:true support
function parseQuery(query: string): { text: string; tags: string[]; filters: Record<string, boolean> } {
  const filters: Record<string, boolean> = {};
  const tags: string[] = [];
  let text = query;

  // Extract tag filters
  const tagMatches = query.match(/tag:(\S+)/g);
  if (tagMatches) {
    tagMatches.forEach(match => {
      const tag = match.replace('tag:', '');
      tags.push(tag);
      text = text.replace(match, '').trim();
    });
  }

  // Extract boolean filters
  const booleanFilters = ['fav:true', 'hidden:true', 'bin:true'];
  booleanFilters.forEach(filter => {
    if (query.includes(filter)) {
      const key = filter.split(':')[0];
      filters[key] = true;
      text = text.replace(filter, '').trim();
    }
  });

  return { text, tags, filters };
}

function calculateRelevance(prompt: any, query: string, tags: string[]): number {
  let score = 0;
  const queryLower = query.toLowerCase();
  
  // Title match (highest weight)
  if (prompt.title?.toLowerCase().includes(queryLower)) {
    score += 100;
  }
  
  // Body match
  if (prompt.body?.toLowerCase().includes(queryLower)) {
    score += 50;
  }
  
  // Tag matches
  if (tags.length > 0) {
    const promptTags = prompt.tags || [];
    tags.forEach(tag => {
      if (promptTags.some((pt: string) => pt.toLowerCase().includes(tag.toLowerCase()))) {
        score += 75;
      }
    });
  }
  
  // Favorite bonus (only if there's already a match)
  if (prompt.favorite && score > 0) {
    score += 10;
  }
  
  return score;
}

function filterPrompts(prompts: any[], query: SearchQuery): SearchResult[] {
  const { text, tags, filters } = parseQuery(query.q);
  
  let filtered = prompts.filter(prompt => {
    // Apply filters
    if (filters.fav && !prompt.favorite) return false;
    if (filters.hidden && !prompt.hidden) return false;
    if (filters.bin && !prompt.deletedAt) return false;
    
    // Apply visibility filters
    if (!query.showHidden && prompt.hidden) return false;
    if (!query.includeBin && prompt.deletedAt) return false;
    
    // Apply text search
    if (text) {
      const relevance = calculateRelevance(prompt, text, tags);
      if (relevance === 0) return false;
      prompt.relevance = relevance;
    }
    
    return true;
  });
  
  // Sort results with favorites always first
  if (query.sortBy === 'relevance' && text) {
    filtered.sort((a, b) => {
      // Favorites come first
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      // Within the same favorite status, sort by relevance
      return (b.relevance || 0) - (a.relevance || 0);
    });
  } else if (query.sortBy === 'title') {
    filtered.sort((a, b) => {
      // Favorites come first
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      // Within the same favorite status, sort by title
      return a.title.localeCompare(b.title);
    });
  } else if (query.sortBy === 'createdAt') {
    filtered.sort((a, b) => {
      // Favorites come first
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      // Within the same favorite status, sort by created date
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  } else if (query.sortBy === 'updatedAt') {
    filtered.sort((a, b) => {
      // Favorites come first
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      // Within the same favorite status, sort by updated date
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  } else if (query.sortBy === 'favorite') {
    filtered.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  } else {
    // Default sorting: favorites first, then by updated date
    filtered.sort((a, b) => {
      // Favorites come first
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      // Within the same favorite status, sort by updated date
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }
  
  if (query.sortOrder === 'asc') {
    filtered.reverse();
  }
  
  return filtered.map(p => ({
    id: p.id,
    title: p.title,
    body: p.body,
    tags: p.tags || [],
    favorite: p.favorite,
    hidden: p.hidden,
    deletedAt: p.deletedAt,
    source: p.source,
    relevance: p.relevance || 0
  }));
}

// Worker message handler
self.onmessage = (e: MessageEvent) => {
  const { prompts, query } = e.data;
  
  try {
    const results = filterPrompts(prompts, query);
    self.postMessage(results);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
