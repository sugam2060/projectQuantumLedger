import { ipcMain } from 'electron';
import Store from 'electron-store';

type AppPreferences = {
  onboardingComplete: boolean;
};

export function registerOnboardingHandlers() {
  const store = new Store<AppPreferences>({
    name: 'user-preferences',
    defaults: {
      onboardingComplete: false,
    },
  });

  ipcMain.handle('onboarding:get-complete', () => store.get('onboardingComplete'));
  ipcMain.handle('onboarding:complete', () => {
    store.set('onboardingComplete', true);
  });
  ipcMain.handle('onboarding:reset', () => {
    store.set('onboardingComplete', false);
  });
}
