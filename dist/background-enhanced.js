// Enhanced background script for Prompt Library with database integration
console.log('Prompt Library enhanced background script loaded');

// Import database module
importScripts('db-working.js');

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
	console.log('Extension installed:', details.reason);
	try {
		// Create context menu
		chrome.contextMenus.create({ id: 'insert-last', title: 'Insert last prompt', contexts: ['editable'] });

		// Set up daily purge alarm
		chrome.alarms.create('purge', { periodInMinutes: 60 * 24 });

		// Load seed prompts if this is a fresh install
		if (details.reason === 'install') {
			await loadSeedPrompts();
		}

		console.log('Extension initialized successfully');
	} catch (error) {
		console.error('Initialization error:', error);
	}
});

// Handle action button click
chrome.action.onClicked.addListener(async (tab) => {
	try {
		if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
	} catch (e) {
		console.error('Failed to open side panel from action:', e);
	}
});

// Handle commands (keyboard shortcuts) — only insert-last
chrome.commands?.onCommand?.addListener(async (command) => {
	try {
		if (command === 'insert-last') {
			const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
			if (tab?.id) {
				const lastId = await promptDB.getMeta('lastUsedPromptId');
				if (lastId) {
					const prompt = await promptDB.getPrompt(lastId);
					if (prompt) {
						await insertIntoTab(tab.id, prompt.body);
						await promptDB.setMeta('lastUsedPromptId', lastId);
					}
				}
			}
		}
	} catch (e) {
		console.error('Command failed:', e);
	}
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId === 'insert-last' && tab?.id) {
		try {
			const lastId = await promptDB.getMeta('lastUsedPromptId');
			if (lastId) {
				const prompt = await promptDB.getPrompt(lastId);
				if (prompt) {
					await insertIntoTab(tab.id, prompt.body);
					// Record usage
					await promptDB.setMeta('lastUsedPromptId', lastId);
				}
			}
		} catch (error) {
			console.error('Failed to insert prompt:', error);
		}
	}
});

// Handle alarms (daily purge)
chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === 'purge') {
		try {
			const purgedCount = await promptDB.purgeDeletedPrompts();
			console.log(`Purged ${purgedCount} old prompts`);
		} catch (error) {
			console.error('Purge failed:', error);
		}
	}
});

// Helper: validate and normalize prompt input
function normalizePrompt(raw) {
	const nowIso = new Date().toISOString();
	const safe = {
		id: raw.id || undefined,
		title: typeof raw.title === 'string' ? raw.title : '',
		body: typeof raw.body === 'string' ? raw.body : '',
		tags: Array.isArray(raw.tags) ? raw.tags.filter(t => typeof t === 'string') : [],
		category: typeof raw.category === 'string' ? raw.category : 'general',
		favorite: !!raw.favorite,
		hidden: !!raw.hidden,
		deletedAt: raw.deletedAt || null,
		createdAt: raw.createdAt || nowIso,
		updatedAt: nowIso,
		version: raw.version || 1,
		source: raw.source,
		originId: raw.originId
	};
	return safe;
}

// Protection: prevent updates/deletes to seed prompts
async function assertNotSeed(id) {
	const p = await promptDB.getPrompt(id);
	if (p && p.source === 'seed') {
		throw new Error('Seed prompt is read-only. Clone to edit.');
	}
}

// Merge helper: prefer newer updatedAt; accept array or object formats
async function mergeDataWithLocal(importData) {
	const localPrompts = await promptDB.getAllPrompts(true);
	const localMeta = await promptDB.getAllMeta();

	const incomingPrompts = Array.isArray(importData)
		? importData
		: (Array.isArray(importData.prompts) ? importData.prompts : []);
	const incomingMeta = Array.isArray(importData?.meta) ? importData.meta : [];

	const byId = new Map(localPrompts.map(p => [p.id, p]));
	const mergedPrompts = [];

	for (const incoming of incomingPrompts) {
		const existing = incoming.id ? byId.get(incoming.id) : undefined;
		if (!existing) {
			mergedPrompts.push(incoming);
		} else {
			const newer = (new Date(incoming.updatedAt || 0).getTime() > new Date(existing.updatedAt || 0).getTime()) ? incoming : existing;
			mergedPrompts.push(newer);
			byId.delete(incoming.id);
		}
	}
	for (const remaining of byId.values()) mergedPrompts.push(remaining);

	const metaByKey = new Map(localMeta.map(m => [m.key, m]));
	const mergedMeta = [];
	for (const incoming of incomingMeta) {
		const existing = metaByKey.get(incoming.key);
		if (!existing) mergedMeta.push(incoming);
		else mergedMeta.push(new Date(incoming.updatedAt || 0).getTime() > new Date(existing.updatedAt || 0).getTime() ? incoming : existing);
		metaByKey.delete(incoming.key);
	}
	for (const remaining of metaByKey.values()) mergedMeta.push(remaining);

	return { prompts: mergedPrompts, meta: mergedMeta };
}

// Handle messages from content scripts and UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'ping') {
		sendResponse({ status: 'ok' });
	} else if (message.type === 'insert') {
		chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
			if (tabs[0]?.id) {
				try {
					await insertIntoTab(tabs[0].id, message.text);
					sendResponse({ success: true });
				} catch (error) {
					console.error('Insert failed:', error);
					sendResponse({ success: false, error: error.message });
				}
			}
		});
		return true;
	} else if (message.type === 'getPrompts') {
		(async () => {
			try {
				const prompts = await promptDB.searchPrompts(message.query, message.filters);
				sendResponse({ success: true, prompts });
			} catch (error) {
				console.error('Get prompts failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'getAllPrompts') {
		(async () => {
			try {
				const prompts = await promptDB.getAllPrompts(true);
				sendResponse({ success: true, prompts });
			} catch (error) {
				console.error('Get all prompts failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'addPrompt') {
		(async () => {
			try {
				const normalized = normalizePrompt(message.prompt || {});
				const prompt = await promptDB.addPrompt(normalized);
				sendResponse({ success: true, prompt });
			} catch (error) {
				console.error('Add prompt failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'updatePrompt') {
		(async () => {
			try {
				const original = await promptDB.getPrompt(message.id);
				if (!original) throw new Error('Prompt not found');

				// If seed: only allow favorite/hidden toggles
				if (original.source === 'seed') {
					const allowedKeys = ['favorite', 'hidden'];
					const updateKeys = Object.keys(message.updates || {});
					const disallowed = updateKeys.filter(k => !allowedKeys.includes(k));
					if (disallowed.length > 0) {
						throw new Error('Seed prompt is read-only. Clone to edit.');
					}
					const toggles = {};
					if ('favorite' in message.updates) toggles.favorite = !!message.updates.favorite;
					if ('hidden' in message.updates) toggles.hidden = !!message.updates.hidden;
					const prompt = await promptDB.updatePrompt(message.id, toggles);
					sendResponse({ success: true, prompt });
					return;
				}

				// Non-seed: sanitize updates (including restore via deletedAt)
				const u = message.updates || {};
				const sanitized = {};
				if ('title' in u) sanitized.title = typeof u.title === 'string' ? u.title : '';
				if ('body' in u) sanitized.body = typeof u.body === 'string' ? u.body : '';
				if ('tags' in u) sanitized.tags = Array.isArray(u.tags) ? u.tags.filter(t => typeof t === 'string') : [];
				if ('category' in u) sanitized.category = typeof u.category === 'string' ? u.category : 'general';
				if ('favorite' in u) sanitized.favorite = !!u.favorite;
				if ('hidden' in u) sanitized.hidden = !!u.hidden;
				if ('deletedAt' in u) sanitized.deletedAt = (u.deletedAt === null || typeof u.deletedAt === 'string') ? u.deletedAt : null;
				const prompt = await promptDB.updatePrompt(message.id, sanitized);
				sendResponse({ success: true, prompt });
			} catch (error) {
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'deletePrompt') {
		(async () => {
			try {
				await assertNotSeed(message.id);
				await promptDB.deletePrompt(message.id, message.softDelete);
				sendResponse({ success: true });
			} catch (error) {
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'exportData') {
		(async () => {
			try {
				const data = await promptDB.exportData();
				sendResponse({ success: true, data });
			} catch (error) {
				console.error('Export failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'importData') {
		(async () => {
			try {
				const merged = await mergeDataWithLocal(message.data || {});
				for (const p of merged.prompts) await promptDB.addPrompt(p);
				for (const m of merged.meta) await promptDB.setMeta(m.key, m.value);
				sendResponse({ success: true, info: { importedCount: merged.prompts.length, metaCount: merged.meta.length } });
			} catch (error) {
				console.error('Import failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'getMeta') {
		(async () => {
			try {
				const value = await promptDB.getMeta(message.key);
				sendResponse({ success: true, value });
			} catch (error) {
				console.error('Get meta failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'setMeta') {
		(async () => {
			try {
				await promptDB.setMeta(message.key, message.value);
				sendResponse({ success: true });
			} catch (error) {
				console.error('Set meta failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'driveBackup') {
		(async () => {
			try {
				const data = await promptDB.exportData();
				await promptDB.setMeta('driveLastBackupAt', new Date().toISOString());
				await promptDB.setMeta('driveLastBackupPreviewCount', data.prompts.length);
				// Placeholder: real Drive upload would go here
				sendResponse({ success: true, info: { count: data.prompts.length } });
			} catch (error) {
				console.error('Drive backup failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	} else if (message.type === 'driveRestore') {
		(async () => {
			try {
				// Placeholder: real Drive restore would fetch data
				const data = await promptDB.exportData(); // use local data as a stand-in
				const merged = await mergeDataWithLocal(data);
				for (const p of merged.prompts) await promptDB.addPrompt(p);
				sendResponse({ success: true, info: { count: merged.prompts.length } });
			} catch (error) {
				console.error('Drive restore failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	}
});

// Insert text into active tab
async function insertIntoTab(tabId, text) {
	try {
		await chrome.scripting.executeScript({
			target: { tabId },
			func: (textToInsert) => {
				const activeElement = document.activeElement;
				if (activeElement && (activeElement.value !== undefined || activeElement.isContentEditable)) {
					if (activeElement.value !== undefined) {
						const start = activeElement.selectionStart || 0;
						const end = activeElement.selectionEnd || 0;
						activeElement.setRangeText(textToInsert, start, end, 'end');
						activeElement.dispatchEvent(new Event('input', { bubbles: true }));
					} else {
						const selection = window.getSelection();
						if (selection.rangeCount > 0) {
							const range = selection.getRangeAt(0);
							range.deleteContents();
							range.insertNode(document.createTextNode(textToInsert));
						}
					}
					return true;
				}
				return false;
			},
			args: [text]
		});
	} catch (error) {
		console.error('Script execution failed:', error);
		try {
			await navigator.clipboard.writeText(text);
			console.log('Text copied to clipboard as fallback');
		} catch (clipboardError) {
			console.error('Clipboard fallback failed:', clipboardError);
		}
	}
}

// Load seed prompts for new installations (from packaged JSON if available)
async function loadSeedPrompts() {
	try {
		const url = chrome.runtime.getURL('data/seed.json');
		const res = await fetch(url);
		if (res.ok) {
			const json = await res.json();
			const seeds = Array.isArray(json) ? json : (json.prompts || []);
			for (const raw of seeds) {
				const normalized = normalizePrompt({ ...raw, source: 'seed' });
				normalized.originId = normalized.id;
				normalized.id = undefined; // let DB assign id
				await promptDB.addPrompt(normalized);
			}
			console.log('Seed prompts loaded from data/seed.json');
			return;
		}
		console.warn('seed.json not found or not ok, falling back to built-in seeds');
	} catch (error) {
		console.warn('Failed to fetch seed.json, using fallback seeds');
	}

	// Fallback seeds
	const seedPrompts = [
		{ title: 'Sales Follow-up', body: 'Hi {{name}}...', tags: ['sales','follow-up','email'], category: 'sales', favorite: true },
		{ title: 'Engineering Code Review', body: 'Please review this code...', tags: ['engineering','code-review','development'], category: 'engineering', favorite: true },
		{ title: 'Finance Report Request', body: 'Could you please provide...', tags: ['finance','report','request'], category: 'finance', favorite: false }
	];
	for (const raw of seedPrompts) {
		const normalized = normalizePrompt({ ...raw, source: 'seed' });
		normalized.originId = normalized.id;
		normalized.id = undefined;
		await promptDB.addPrompt(normalized);
	}
	console.log('Seed prompts loaded (fallback)');
}

async function openSidePanelFallback(tabId) {
	// Strategy: open a temporary side panel page as a new tab to simulate user gesture
	try {
		const url = chrome.runtime.getURL('sidepanel/index.html');
		await chrome.tabs.create({ url, active: true });
	} catch (e) {
		console.error('Fallback open failed:', e);
	}
}
