import { ask, message } from '@tauri-apps/plugin-dialog';
import { t } from './i18n';

// Buscar e instalar actualizaciones (releases firmados de GitHub).
// En Linux el updater sólo aplica al AppImage; una instalación por .deb
// recibe el aviso pero debe actualizar con el paquete.

export const checkForUpdates = async (silent: boolean): Promise<void> => {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      if (!silent) {
        await message(t('update.upToDate'), { title: 'iureditor', kind: 'info' });
      }
      return;
    }
    const install = await ask(
      t('update.available', { version: update.version }),
      {
        title: t('update.availableTitle'),
        kind: 'info',
        okLabel: t('update.update'),
        cancelLabel: t('update.notNow'),
      }
    );
    if (!install) return;
    try {
      await update.downloadAndInstall();
    } catch (err) {
      // El usuario ya pidió actualizar: mostrar el error aunque el chequeo sea silencioso.
      console.error('Instalación de la actualización falló:', err);
      const detail = err instanceof Error ? err.message : String(err);
      const open = await ask(t('update.installFailed', { detail }), {
        title: 'iureditor',
        kind: 'warning',
        okLabel: t('update.openDownload'),
        cancelLabel: t('update.later'),
      });
      if (open) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl('https://github.com/ellaguno/iureditor/releases/latest');
      }
      return;
    }
    const restart = await ask(t('update.installed'), {
      title: 'iureditor',
      kind: 'info',
      okLabel: t('update.restart'),
      cancelLabel: t('update.later'),
    });
    if (restart) {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    }
  } catch (err) {
    // Sin red, endpoint aún sin latest.json, o instalación .deb (Linux):
    // el chequeo silencioso de arranque no molesta al usuario.
    console.error('Chequeo de actualizaciones falló:', err);
    if (!silent) {
      const detail = err instanceof Error ? err.message : String(err);
      await message(
        t('update.failed', { detail }),
        { title: 'iureditor', kind: 'warning' }
      );
    }
  }
};
