import { getChromeAccessToken } from "./auth.chrome";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const APPDATA_Q = "name = 'prompt-library-backup.json' and 'appDataFolder' in parents";

export async function backupToDrive(payload: object): Promise<void> {
  const token = await getChromeAccessToken();
  const id = await findExisting(token);
  if (id) {
    await uploadContent(token, id, JSON.stringify(payload));
  } else {
    const newId = await createFile(token);
    await uploadContent(token, newId, JSON.stringify(payload));
  }
}

export async function restoreFromDrive<T>(): Promise<T | null> {
  const token = await getChromeAccessToken();
  const id = await findExisting(token);
  if (!id) return null;
  const res = await fetch(`${DRIVE_FILES}/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Restore failed");
  return res.json() as Promise<T>;
}

export async function mergeWithLocal<T extends { prompts?: any[]; meta?: any[] }>(
  driveData: T,
  localPrompts: any[],
  localMeta: any[]
): Promise<{ prompts: any[]; meta: any[] }> {
  const drivePrompts = driveData.prompts || [];
  const driveMeta = driveData.meta || [];
  
  // Merge prompts, keeping the most recently updated version
  const promptMap = new Map();
  
  // Add local prompts first
  localPrompts.forEach(prompt => {
    promptMap.set(prompt.id, prompt);
  });
  
  // Merge with drive prompts, keeping the newer version
  drivePrompts.forEach(drivePrompt => {
    const localPrompt = promptMap.get(drivePrompt.id);
    if (!localPrompt || new Date(drivePrompt.updatedAt) > new Date(localPrompt.updatedAt)) {
      promptMap.set(drivePrompt.id, drivePrompt);
    }
  });
  
  // Merge meta data similarly
  const metaMap = new Map();
  localMeta.forEach(meta => {
    metaMap.set(meta.key, meta);
  });
  
  driveMeta.forEach(driveMetaItem => {
    const localMetaItem = metaMap.get(driveMetaItem.key);
    if (!localMetaItem || new Date(driveMetaItem.updatedAt) > new Date(localMetaItem.updatedAt)) {
      metaMap.set(driveMetaItem.key, driveMetaItem);
    }
  });
  
  return {
    prompts: Array.from(promptMap.values()),
    meta: Array.from(metaMap.values())
  };
}

async function findExisting(token: string): Promise<string | null> {
  const url = `${DRIVE_FILES}?spaces=appDataFolder&q=${encodeURIComponent(APPDATA_Q)}&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Drive list failed");
  const json = await res.json();
  return json.files?.[0]?.id || null;
}

async function createFile(token: string): Promise<string> {
  const meta = { name: "prompt-library-backup.json", parents: ["appDataFolder"] };
  const init = await fetch(`${DRIVE_UPLOAD}?uploadType=resumable`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/json"
    },
    body: JSON.stringify(meta)
  });
  if (!init.ok) throw new Error("Init upload failed");
  const loc = init.headers.get("location");
  if (!loc) throw new Error("No upload session");
  const put = await fetch(loc, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: "{}" });
  if (!put.ok) throw new Error("Create file failed");
  const created = await put.json();
  return created.id as string;
}

async function uploadContent(token: string, id: string, body: string) {
  const res = await fetch(`${DRIVE_UPLOAD}/${id}?uploadType=media`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body
  });
  if (!res.ok) throw new Error("Backup failed");
}
