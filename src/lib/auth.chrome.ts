export async function getChromeAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError?.message || "No token");
      } else {
        resolve(token);
      }
    });
  });
}
