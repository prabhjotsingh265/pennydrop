import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { prerender } from 'react-dom/static';
import { StaticRouterProvider, createStaticHandler, createStaticRouter } from 'react-router';
import { routes } from './router.tsx';

/**
 * A public page as HTML, at build time (scripts/prerender.ts): search engines and link previews
 * read it without running anything, and visitors see it before the app's code arrives. Signed
 * out, in the light theme; no hydration data, which would be an inline script the content
 * security policy refuses.
 */
export async function render(path: string): Promise<string> {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost${path}`));
  if (context instanceof Response) throw new Error(`${path} answered ${context.status}.`);
  const router = createStaticRouter(handler.dataRoutes, context);
  const { prelude } = await prerender(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <StaticRouterProvider router={router} context={context} hydrate={false} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return new Response(prelude).text();
}
