import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopClient', {
  getOnboardingComplete: (): Promise<boolean> =>
    ipcRenderer.invoke('onboarding:get-complete') as Promise<boolean>,
  completeOnboarding: (): Promise<void> =>
    ipcRenderer.invoke('onboarding:complete') as Promise<void>,
  resetOnboarding: (): Promise<void> =>
    ipcRenderer.invoke('onboarding:reset') as Promise<void>,
});
