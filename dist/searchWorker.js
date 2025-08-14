// src/lib/searchWorker.ts
function parseQuery(query) {
  const filters = {};
  const tags = [];
  let text = query;
  const tagMatches = query.match(/tag:(\S+)/g);
  if (tagMatches) {
    tagMatches.forEach((match) => {
      const tag = match.replace("tag:", "");
      tags.push(tag);
      text = text.replace(match, "").trim();
    });
  }
  const booleanFilters = ["fav:true", "hidden:true", "bin:true"];
  booleanFilters.forEach((filter) => {
    if (query.includes(filter)) {
      const key = filter.split(":")[0];
      filters[key] = true;
      text = text.replace(filter, "").trim();
    }
  });
  return { text, tags, filters };
}
function calculateRelevance(prompt, query, tags) {
  let score = 0;
  const queryLower = query.toLowerCase();
  if (prompt.title?.toLowerCase().includes(queryLower)) {
    score += 100;
  }
  if (prompt.body?.toLowerCase().includes(queryLower)) {
    score += 50;
  }
  if (tags.length > 0) {
    const promptTags = prompt.tags || [];
    tags.forEach((tag) => {
      if (promptTags.some((pt) => pt.toLowerCase().includes(tag.toLowerCase()))) {
        score += 75;
      }
    });
  }
  if (prompt.favorite && score > 0) {
    score += 10;
  }
  return score;
}
function filterPrompts(prompts, query) {
  const { text, tags, filters } = parseQuery(query.q);
  let filtered = prompts.filter((prompt) => {
    if (filters.fav && !prompt.favorite)
      return false;
    if (filters.hidden && !prompt.hidden)
      return false;
    if (filters.bin && !prompt.deletedAt)
      return false;
    if (!query.showHidden && prompt.hidden)
      return false;
    if (!query.includeBin && prompt.deletedAt)
      return false;
    if (text) {
      const relevance = calculateRelevance(prompt, text, tags);
      if (relevance === 0)
        return false;
      prompt.relevance = relevance;
    }
    return true;
  });
  if (query.sortBy === "relevance" && text) {
    filtered.sort((a, b) => {
      if (a.favorite && !b.favorite)
        return -1;
      if (!a.favorite && b.favorite)
        return 1;
      return (b.relevance || 0) - (a.relevance || 0);
    });
  } else if (query.sortBy === "title") {
    filtered.sort((a, b) => {
      if (a.favorite && !b.favorite)
        return -1;
      if (!a.favorite && b.favorite)
        return 1;
      return a.title.localeCompare(b.title);
    });
  } else if (query.sortBy === "createdAt") {
    filtered.sort((a, b) => {
      if (a.favorite && !b.favorite)
        return -1;
      if (!a.favorite && b.favorite)
        return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  } else if (query.sortBy === "updatedAt") {
    filtered.sort((a, b) => {
      if (a.favorite && !b.favorite)
        return -1;
      if (!a.favorite && b.favorite)
        return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  } else if (query.sortBy === "favorite") {
    filtered.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  } else {
    filtered.sort((a, b) => {
      if (a.favorite && !b.favorite)
        return -1;
      if (!a.favorite && b.favorite)
        return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }
  if (query.sortOrder === "asc") {
    filtered.reverse();
  }
  return filtered.map((p) => ({
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
self.onmessage = (e) => {
  const { prompts, query } = e.data;
  try {
    const results = filterPrompts(prompts, query);
    self.postMessage(results);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
//# sourceMappingURL=searchWorker.js.map
