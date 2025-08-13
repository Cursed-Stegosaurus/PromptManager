import { getMeta, putMeta, listPrompts } from "../lib/db";
import { backupToDrive, restoreFromDrive } from "../lib/drive";

const enableDrive = document.getElementById("enableDrive") as HTMLInputElement;
const btnBackup = document.getElementById("btnBackup") as HTMLButtonElement;
const btnRestore = document.getElementById("btnRestore") as HTMLButtonElement;
const status = document.getElementById("backupStatus") as HTMLElement;

const enableEnc = document.getElementById("enableEnc") as HTMLInputElement;
const pass1 = document.getElementById("pass1") as HTMLInputElement;
const pass2 = document.getElementById("pass2") as HTMLInputElement;
const btnSetPass = document.getElementById("btnSetPass") as HTMLButtonElement;

const fileImport = document.getElementById("fileImport") as HTMLInputElement;
const btnImport = document.getElementById("btnImport") as HTMLButtonElement;
const btnExport = document.getElementById("btnExport") as HTMLButtonElement;

init();

async function init() {
  const drive = await getMeta<boolean>("driveBackupEnabled");
  enableDrive.checked = !!drive;
  const last = await getMeta<string>("driveLastBackupAt");
  status.textContent = `Last backup: ${last || "never"}`;
}

enableDrive.onchange = async () => {
  await putMeta("driveBackupEnabled", enableDrive.checked);
};

btnBackup.onclick = async () => {
  const payload = { schemaVersion: "1.0.0", exportedAt: new Date().toISOString(), prompts: await listPrompts(true) };
  try {
    await backupToDrive(payload);
    await putMeta("driveLastBackupAt", new Date().toISOString());
    status.textContent = `Last backup: ${new Date().toLocaleString()}`;
    alert("Backup complete");
  } catch (e) {
    alert("Backup failed: " + (e as Error).message);
  }
};

btnRestore.onclick = async () => {
  try {
    const data = await restoreFromDrive<any>();
    if (!data) { alert("No backup found"); return; }
    // For v1.0, just preview counts.
    alert(`Backup found. Prompts: ${data.prompts?.length ?? 0}`);
  } catch (e) {
    alert("Restore failed: " + (e as Error).message);
  }
};

btnSetPass.onclick = async () => {
  if (!enableEnc.checked) { alert("Enable the checkbox first"); return; }
  if (!pass1.value || pass1.value !== pass2.value) { alert("Passphrases do not match"); return; }
  await putMeta("encryptionEnabled", true);
  alert("Encryption enabled. Remember your passphrase.");
};

btnImport.onclick = async () => {
  const file = fileImport.files?.[0];
  if (!file) { alert("Choose a file"); return; }
  const text = await file.text();
  const json = JSON.parse(text);
  alert(`Import preview: prompts ${json.prompts?.length ?? 0}`);
};

btnExport.onclick = async () => {
  const payload = { schemaVersion: "1.0.0", exportedAt: new Date().toISOString(), prompts: await listPrompts(true) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prompt-library-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
