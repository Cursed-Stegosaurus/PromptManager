import { describe, it, expect, beforeEach } from 'vitest';
import { encryptPrompt, decryptPrompt, generateKey } from '../src/lib/crypto';

describe('Crypto Functions', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    key = await generateKey();
  });

  it('should encrypt and decrypt prompt data correctly', async () => {
    const originalData = {
      id: 'test-123',
      title: 'Test Prompt',
      content: 'This is a test prompt content',
      tags: ['test', 'example']
    };

    const encrypted = await encryptPrompt(originalData, key);
    expect(encrypted).toBeDefined();
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toBe(JSON.stringify(originalData));

    const decrypted = await decryptPrompt(encrypted, key);
    expect(decrypted).toEqual(originalData);
  });

  it('should handle empty data', async () => {
    const emptyData = {};

    const encrypted = await encryptPrompt(emptyData, key);
    const decrypted = await decryptPrompt(encrypted, key);

    expect(decrypted).toEqual(emptyData);
  });

  it('should handle complex nested data', async () => {
    const complexData = {
      id: 'complex-123',
      metadata: {
        created: new Date().toISOString(),
        author: 'Test User',
        version: 1.0
      },
      content: {
        text: 'Complex prompt with nested structure',
        variables: ['var1', 'var2'],
        settings: {
          maxLength: 1000,
          allowHtml: false
        }
      }
    };

    const encrypted = await encryptPrompt(complexData, key);
    const decrypted = await decryptPrompt(encrypted, key);

    expect(decrypted).toEqual(complexData);
  });

  it('should fail decryption with wrong key', async () => {
    const data = { test: 'data' };
    const wrongKey = await generateKey();

    const encrypted = await encryptPrompt(data, key);

    await expect(decryptPrompt(encrypted, wrongKey)).rejects.toThrow();
  });

  it('should fail decryption with corrupted data', async () => {
    const corruptedData = 'corrupted-encrypted-data';

    await expect(decryptPrompt(corruptedData, key)).rejects.toThrow();
  });

  it('should generate unique keys', async () => {
    const key1 = await generateKey();
    const key2 = await generateKey();

    expect(key1).not.toEqual(key2);
  });

  it('should handle special characters in data', async () => {
    const specialData = {
      content: 'Special chars: & < > " \' / \n \t \r',
      html: '<div class="test">Content</div>',
      unicode: '🚀 🌟 💡 🎯'
    };

    const encrypted = await encryptPrompt(specialData, key);
    const decrypted = await decryptPrompt(encrypted, key);

    expect(decrypted).toEqual(specialData);
  });
});
