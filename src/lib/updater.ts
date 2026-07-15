import { ask, message } from '@tauri-apps/plugin-dialog';

// Buscar e instalar actualizaciones (releases firmados de GitHub).
// En Linux el updater sólo aplica al AppImage; una instalación por .deb
// recibe el aviso pero debe actualizar con el paquete.

export const checkForUpdates = async (silent: boolean): Promise<void> => {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      if (!silent) {
        await message('Ya tienes la última versión.', { title: 'iureditor', kind: 'info' });
      }
      return;
    }
    const install = await ask(
      `Hay una nueva versión de iureditor (${update.version}).\n¿Descargar e instalar ahora?`,
      {
        title: 'iureditor — Actualización disponible',
        kind: 'info',
        okLabel: 'Actualizar',
        cancelLabel: 'Ahora no',
      }
    );
    if (!install) return;
    await update.downloadAndInstall();
    const restart = await ask('Actualización instalada. ¿Reiniciar iureditor ahora?', {
      title: 'iureditor',
      kind: 'info',
      okLabel: 'Reiniciar',
      cancelLabel: 'Después',
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
        `No se pudo buscar actualizaciones.\nSi instalaste con .deb, descarga la nueva versión desde GitHub.\n\nDetalle: ${detail}`,
        { title: 'iureditor', kind: 'warning' }
      );
    }
  }
};
