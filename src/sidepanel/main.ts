import { listPrompts, putPrompt, getPrompt, getMeta, putMeta } from "../lib/db";
import type { Prompt } from "../lib/schema";
import { renderTemplate } from "../lib/template";

const q = document.getElementById("search") as HTMLInputElement;
const list = document.getElementById("list")!;
const titleEl = document.getElementById("title")!;
const bodyEl = document.getElementById("body") as HTMLTextAreaElement;
const toast = document.getElementById("toast") as HTMLElement;

let currentId: string | null = null;

init();

async function init() {
  await ensureSeeds();
  wireEvents();
  refresh();
}

function wireEvents() {
  q.oninput = () => refresh();

  (document.getElementById("btn-insert") as HTMLButtonElement).onclick = async () => {
    if (!currentId) return;
    const p = await getPrompt(currentId);
    if (!p) return;
    await chrome.runtime.sendMessage({ type: "insert", text: bodyEl.value });
    showToast("Inserted or copied");
  };

  (document.getElementById("btn-copy") as HTMLButtonElement).onclick = async () => {
    await navigator.clipboard.writeText(bodyEl.value);
    showToast("Copied to clipboard");
  };

  (document.getElementById("btn-fav") as HTMLButtonElement).onclick = toggleFavorite;
  (document.getElementById("btn-hide") as HTMLButtonElement).onclick = toggleHidden;
  (document.getElementById("btn-clone") as HTMLButtonElement).onclick = cloneCurrent;
  (document.getElementById("btn-delete") as HTMLButtonElement).onclick = trashCurrent;
}

async function ensureSeeds() {
  await chrome.runtime.sendMessage({ type: "seed:ensure" }).catch(() => {});
}

async function refresh() {
  const items = await listPrompts();
  const term = q.value.toLowerCase();
  const filtered = items
    .filter(it => match(it, term))
    .filter(it => !it.hidden && !it.deletedAt);

  list.innerHTML = "";
  for (const p of filtered) {
    const div = document.createElement("div");
    div.className = "item" + (p.id === currentId ? " active" : "");
    div.textContent = p.title;
    div.onclick = () => select(p.id);
    list.appendChild(div);
  }

  // Auto select first if none selected
  if (!currentId && filtered[0]) {
    select(filtered[0].id);
  }
}

function match(p: Prompt, term: string): boolean {
  if (!term) return true;
  const hay = `${p.title} ${p.tags.join(" ")} ${p.body}`.toLowerCase();
  return term.split(/\s+/).every(t => hay.includes(t));
}

async function select(id: string) {
  currentId = id;
  const p = await getPrompt(id);
  if (!p) return;
  titleEl.textContent = p.title;
  bodyEl.value = p.body;
  await putMeta("lastUsedPromptId", id);
  refreshListClasses();
}

function refreshListClasses() {
  for (const el of Array.from(list.children)) {
    el.classList.toggle("active", (el as HTMLElement).textContent === titleEl.textContent);
  }
}

function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => (toast.hidden = true), 1200);
}

async function toggleFavorite() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  p.favorite = !p.favorite;
  p.updatedAt = new Date().toISOString();
  await putPrompt(p);
  await refresh();
  await select(p.id);
}

async function toggleHidden() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  p.hidden = !p.hidden;
  p.updatedAt = new Date().toISOString();
  await putPrompt(p);
  currentId = null;
  await refresh();
}

async function cloneCurrent() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  const clone: Prompt = {
    ...p,
    id: crypto.randomUUID(),
    source: "user",
    originId: p.source === "seed" ? p.id : p.originId,
    title: p.title + " (copy)",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  };
  await putPrompt(clone);
  await select(clone.id);
  showToast("Cloned");
}

async function trashCurrent() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  p.deletedAt = new Date().toISOString();
  await putPrompt(p);
  currentId = null;
  titleEl.textContent = "";
  bodyEl.value = "";
  await refresh();
  showToast("Moved to bin");
}
