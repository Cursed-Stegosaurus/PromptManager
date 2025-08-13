// src/lib/searchWorker.ts
self.onmessage = (e) => {
  const { items, query } = e.data;
  const res = search(items, query);
  self.postMessage(res);
};
function search(items, q) {
  const { tokens, filters, exactMatches } = parse(q.q);
  let filtered = items.filter((it) => {
    if (!q.includeBin && it.deletedAt) return false;
    if (!q.showHidden && it.hidden) return false;
    if (filters.fav === true && !it.favorite) return false;
    if (filters.hidden === true && !it.hidden) return false;
    if (filters.bin === true && !it.deletedAt) return false;
    if (filters.category && it.category !== filters.category) return false;
    if (filters.date && it.updatedAt) {
      const itemDate = new Date(it.updatedAt);
      const filterDate = new Date(filters.date);
      if (itemDate < filterDate) return false;
    }
    return true;
  });
  if (tokens.length === 0 && Object.keys(filters).length === 0) {
    return sortResults(filtered.map((item) => ({ item, score: 0, matches: [] })), q.sortBy, q.sortOrder);
  }
  const results = filtered.map((item) => {
    const { score, matches } = calculateScore(item, tokens, exactMatches);
    return { item, score, matches };
  }).filter((result) => result.score > 0);
  const sorted = sortResults(results, q.sortBy, q.sortOrder);
  return sorted.map((result) => result.item);
}
function calculateScore(item, tokens, exactMatches) {
  let score = 0;
  const matches = [];
  const searchableText = `${item.title} ${item.tags.join(" ")} ${item.body}`.toLowerCase();
  for (const token of tokens) {
    let tokenScore = 0;
    let found = false;
    if (exactMatches.includes(token)) {
      if (item.title.toLowerCase().includes(token)) {
        tokenScore += 100;
        found = true;
      }
      if (item.tags.some((tag) => tag.toLowerCase().includes(token))) {
        tokenScore += 80;
        found = true;
      }
      if (item.body.toLowerCase().includes(token)) {
        tokenScore += 60;
        found = true;
      }
    } else {
      if (item.title.toLowerCase().includes(token)) {
        tokenScore += 50;
        found = true;
      }
      if (item.tags.some((tag) => tag.toLowerCase().includes(token))) {
        tokenScore += 40;
        found = true;
      }
      if (item.body.toLowerCase().includes(token)) {
        tokenScore += 20;
        found = true;
      }
      if (!found) {
        const words = searchableText.split(/\s+/);
        for (const word of words) {
          if (word.startsWith(token) || word.endsWith(token)) {
            tokenScore += 10;
            found = true;
            break;
          }
        }
      }
    }
    if (found) {
      score += tokenScore;
      matches.push(token);
    }
  }
  if (item.favorite) score += 5;
  if (item.updatedAt) {
    const daysSinceUpdate = (Date.now() - new Date(item.updatedAt).getTime()) / (1e3 * 60 * 60 * 24);
    if (daysSinceUpdate < 7) score += 3;
    else if (daysSinceUpdate < 30) score += 1;
  }
  return { score, matches };
}
function sortResults(results, sortBy, sortOrder = "desc") {
  if (sortBy === "relevance" || !sortBy) {
    return results.sort((a, b) => b.score - a.score);
  }
  return results.sort((a, b) => {
    let aVal, bVal;
    switch (sortBy) {
      case "title":
        aVal = a.item.title.toLowerCase();
        bVal = b.item.title.toLowerCase();
        break;
      case "createdAt":
        aVal = a.item.createdAt || "";
        bVal = b.item.createdAt || "";
        break;
      case "updatedAt":
        aVal = a.item.updatedAt || "";
        bVal = b.item.updatedAt || "";
        break;
      case "favorite":
        aVal = a.item.favorite ? 1 : 0;
        bVal = b.item.favorite ? 1 : 0;
        break;
      default:
        return 0;
    }
    if (sortOrder === "asc") {
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    } else {
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    }
  });
}
function parse(input) {
  const parts = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = [];
  const exactMatches = [];
  const filters = {};
  for (const p of parts) {
    if (p.startsWith("fav:")) {
      filters.fav = p.endsWith("true");
    } else if (p.startsWith("hidden:")) {
      filters.hidden = p.endsWith("true");
    } else if (p.startsWith("bin:")) {
      filters.bin = p.endsWith("true");
    } else if (p.startsWith("tag:")) {
      const tag = p.slice(4);
      tokens.push(tag);
      exactMatches.push(tag);
    } else if (p.startsWith("category:")) {
      filters.category = p.slice(9);
    } else if (p.startsWith("date:")) {
      filters.date = p.slice(5);
    } else if (p.startsWith('"') && p.endsWith('"')) {
      const phrase = p.slice(1, -1);
      tokens.push(phrase);
      exactMatches.push(phrase);
    } else {
      tokens.push(p);
    }
  }
  return { tokens, filters, exactMatches };
}
//# sourceMappingURL=searchWorker.js.map
