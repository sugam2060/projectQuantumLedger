import { createHashRouter, redirect } from 'react-router-dom';
import Home from './pages/home';
import Onboarding from './pages/onboarding';
import NotFound from './not-found';

function StartupLoading() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">
      Loading your workspace…
    </main>
  );
}

export const router = createHashRouter([
  {
    path: '/',
    loader: async () =>
      redirect((await window.desktopClient.getOnboardingComplete()) ? '/home' : '/onboarding'),
    element: <StartupLoading />,
    hydrateFallbackElement: <StartupLoading />,
  },
  {
    path: '/onboarding',
    loader: async () =>
      (await window.desktopClient.getOnboardingComplete()) ? redirect('/home') : null,
    element: <Onboarding />,
  },
  {
    path: '/home',
    loader: async () =>
      (await window.desktopClient.getOnboardingComplete()) ? null : redirect('/onboarding'),
    element: <Home />,
  },
  {
    path: '*',
    element: <NotFound />,
  },
]);
