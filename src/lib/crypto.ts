// Crypto utilities for prompt encryption
// Uses Web Crypto API for secure operations

export interface EncryptedData {
  ciphertext: string;
  nonce: string;
  salt: string;
}

// Derive encryption key from passphrase using PBKDF2
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 200000, // 200k iterations for security
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// Encrypt data using AES-GCM
export async function encrypt(data: string, passphrase: string): Promise<EncryptedData> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  
  const key = await deriveKey(passphrase, salt);
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(data);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintext
  );
  
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    nonce: btoa(String.fromCharCode(...nonce)),
    salt: btoa(String.fromCharCode(...salt))
  };
}

// Decrypt data using AES-GCM
export async function decrypt(encryptedData: EncryptedData, passphrase: string): Promise<string> {
  try {
    const salt = Uint8Array.from(atob(encryptedData.salt), c => c.charCodeAt(0));
    const nonce = Uint8Array.from(atob(encryptedData.nonce), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(encryptedData.ciphertext), c => c.charCodeAt(0));
    
    const key = await deriveKey(passphrase, salt);
    
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      ciphertext
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  } catch (error) {
    throw new Error('Decryption failed. Check your passphrase.');
  }
}

// Generate a random salt
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...salt));
}

// Hash a string for comparison (not reversible)
export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}
