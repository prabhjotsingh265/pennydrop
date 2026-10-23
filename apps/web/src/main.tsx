import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createQueryClient, prefetchDashboard } from './lib/queries.ts';
import { applyInitialTheme } from './lib/theme.ts';
import { routes } from './router.tsx';
import './styles.css';

applyInitialTheme();
const queryClient = createQueryClient();
prefetchDashboard(queryClient, window.location.pathname);
const router = createBrowserRouter(routes);

// Rendered once the first page's code is here: before, React would replace a page the build
// rendered ahead of time (the front page, the crawler's) with nothing, for a moment.
await new Promise<void>((resolve) => {
  if (router.state.initialized) return resolve();
  const stop = router.subscribe((state) => {
    if (!state.initialized) return;
    stop();
    resolve();
  });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
