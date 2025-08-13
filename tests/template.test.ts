import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/lib/template';

describe('Template Rendering', () => {
  it('should safely escape HTML characters', () => {
    const template = 'Hello {{name}}, your email is {{email}}';
    const data = {
      name: '<script>alert("xss")</script>',
      email: 'user@example.com'
    };
    
    const result = renderTemplate(template, data);
    
    expect(result).toBe('Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;, your email is user@example.com');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert("xss")');
  });

  it('should handle missing template variables gracefully', () => {
    const template = 'Hello {{name}}, welcome to {{company}}';
    const data = { name: 'John' };
    
    const result = renderTemplate(template, data);
    
    expect(result).toBe('Hello John, welcome to {{company}}');
  });

  it('should handle empty template', () => {
    const template = '';
    const data = { name: 'John' };
    
    const result = renderTemplate(template, data);
    
    expect(result).toBe('');
  });

  it('should handle template with no variables', () => {
    const template = 'Hello World';
    const data = { name: 'John' };
    
    const result = renderTemplate(template, data);
    
    expect(result).toBe('Hello World');
  });

  it('should handle special characters in data', () => {
    const template = 'Message: {{message}}';
    const data = { message: '& < > " \' /' };
    
    const result = renderTemplate(template, data);
    
    expect(result).toBe('Message: &amp; &lt; &gt; &quot; &#x27; &#x2F;');
  });
});
