import { createBrowserRouter, Navigate, Outlet, useNavigation } from 'react-router';
import { ErrorPage } from './landing/ErrorPage.tsx';

// Each page arrives with its own code, when it's first opened: the front page doesn't carry
// the dashboard, nor the dashboard the front page's scroll scenes. The error page is always
// here, for when a page's code can't be fetched.
const dashboard = async () => {
  const [{ RequireAuth }, { Shell }] = await Promise.all([
    import('./app/RequireAuth.tsx'),
    import('./app/Shell.tsx'),
  ]);
  return {
    Component: () => (
      <RequireAuth>
        <Shell />
      </RequireAuth>
    ),
  };
};

/** Every page, with a line along the top while the next one's code is on its way. */
function Root() {
  const loading = useNavigation().state === 'loading';
  return (
    <>
      {loading && <div className="page-loading" aria-hidden="true" />}
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  // Whatever any page throws ends on the error page, not a blank screen.
  {
    Component: Root,
    errorElement: <ErrorPage />,
    // The first page's code is fetched before anything shows: the page's own background till then.
    hydrateFallbackElement: null,
    children: [
      {
        path: '/',
        lazy: () => import('./landing/Landing.tsx').then((m) => ({ Component: m.Landing })),
      },
      {
        path: '/bot',
        lazy: () => import('./landing/BotPage.tsx').then((m) => ({ Component: m.BotPage })),
      },
      {
        path: '/privacy',
        lazy: () => import('./landing/PrivacyPage.tsx').then((m) => ({ Component: m.PrivacyPage })),
      },
      {
        path: '/terms',
        lazy: () => import('./landing/TermsPage.tsx').then((m) => ({ Component: m.TermsPage })),
      },
      {
        path: '/signin',
        lazy: () => import('./auth/SignIn.tsx').then((m) => ({ Component: m.SignIn })),
      },
      {
        path: '/signup',
        lazy: () => import('./auth/SignUp.tsx').then((m) => ({ Component: m.SignUp })),
      },
      {
        path: '/signup/sent',
        lazy: () => import('./auth/CheckEmail.tsx').then((m) => ({ Component: m.CheckEmail })),
      },
      {
        path: '/demo',
        lazy: () => import('./auth/DemoPage.tsx').then((m) => ({ Component: m.DemoPage })),
      },
      {
        path: '/forgot',
        lazy: () => import('./auth/Forgot.tsx').then((m) => ({ Component: m.Forgot })),
      },
      {
        path: '/reset',
        lazy: () => import('./auth/Reset.tsx').then((m) => ({ Component: m.Reset })),
      },
      {
        path: '/app',
        lazy: dashboard,
        children: [
          {
            index: true,
            lazy: () =>
              import('./app/WatchlistPage.tsx').then((m) => ({ Component: m.WatchlistPage })),
          },
          {
            path: 'add',
            lazy: () => import('./app/add/AddPage.tsx').then((m) => ({ Component: m.AddPage })),
          },
          {
            path: 'p/:id',
            lazy: () =>
              import('./app/product/ProductPage.tsx').then((m) => ({ Component: m.ProductPage })),
          },
          {
            path: 'sites',
            lazy: () => import('./app/SitesPage.tsx').then((m) => ({ Component: m.SitesPage })),
          },
          {
            path: 'checks',
            lazy: () => import('./app/ChecksPage.tsx').then((m) => ({ Component: m.ChecksPage })),
          },
          {
            path: 'groups',
            lazy: () => import('./app/GroupsPage.tsx').then((m) => ({ Component: m.GroupsPage })),
          },
          {
            path: 'groups/:id',
            lazy: () => import('./app/ComparePage.tsx').then((m) => ({ Component: m.ComparePage })),
          },
          {
            path: 'alerts',
            lazy: () => import('./app/AlertsPage.tsx').then((m) => ({ Component: m.AlertsPage })),
          },
          {
            path: 'channels',
            lazy: () =>
              import('./app/ChannelsPage.tsx').then((m) => ({ Component: m.ChannelsPage })),
          },
          {
            path: 'settings',
            lazy: () =>
              import('./app/SettingsPage.tsx').then((m) => ({ Component: m.SettingsPage })),
          },
        ],
      },
      // The phase-0 design prototype grew into the landing page.
      // The platform's own page, for its admins, in the dashboard's frame.
      {
        path: '/admin',
        lazy: dashboard,
        children: [
          {
            index: true,
            lazy: () =>
              import('./app/admin/SystemPage.tsx').then((m) => ({ Component: m.SystemPage })),
          },
        ],
      },
      { path: '/prototype', element: <Navigate to="/" replace /> },
      {
        path: '*',
        lazy: () =>
          import('./landing/NotFoundPage.tsx').then((m) => ({ Component: m.NotFoundPage })),
      },
    ],
  },
]);
