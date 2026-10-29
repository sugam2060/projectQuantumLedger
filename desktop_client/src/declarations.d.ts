/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  desktopClient: {
    getOnboardingComplete(): Promise<boolean>;
    completeOnboarding(): Promise<void>;
    resetOnboarding(): Promise<void>;
  };
}
