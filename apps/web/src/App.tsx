import { useEffect, useState } from 'react';

type ApiState = 'checking' | 'ok' | 'down';

export function App() {
  const [api, setApi] = useState<ApiState>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((response) => setApi(response.ok ? 'ok' : 'down'))
      .catch(() => setApi('down'));
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center">
      <div className="text-center">
        <h1 className="text-4xl font-semibold">Pennydrop</h1>
        <p className="mt-2 text-sm" data-testid="api-status">
          API: {api}
        </p>
      </div>
    </main>
  );
}
