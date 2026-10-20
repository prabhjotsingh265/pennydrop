import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the name and checks the API', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Pennydrop');
    expect(html).toContain('checking');
  });
});
