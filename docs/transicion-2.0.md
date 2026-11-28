# Transición de IureEditor 1.x (Tauri) a 2.0 (Rust/egui)

Plan del 2026-11-23. Complementa [`plan-2.0.md`](plan-2.0.md) (paridad y decisión del dueño del
2026-11-19: no se publica como principal hasta verse al menos como la 1.19.2).

## Dónde estamos

Hoy **nada lleva a la 2.0 automáticamente**:

| Quién | Qué sigue hoy | Por qué no ve la 2.0 |
|---|---|---|
| Actualizador de la 1.x | `releases/latest/download/latest.json` | La 2.0 no publica `latest.json` ni es «Latest» |
| iureapps | `GET /releases/latest`, paquete tipo Tauri, firma `KEY_8F1B` | Igual; además los `.zip` de Windows y macOS no son instalables por iureapps y no hay `.sig` |
| IureDesk / IureProject | binario `iureditor` y enlaces `iureditor://` | La 2.0 se llama `iureditor2` y no registra `iureditor://` |
| La propia 2.0 | lee el `latest.json` de la 1.x | Siempre dice «al día»; además compara mal `alpha.10` frente a `alpha.6` |

Y la 2.0 todavía no: registra `iureditor://` ni asocia `.md` (salvo `instalar.sh` en Linux), se
actualiza sola, importa preferencias ni recientes de la 1.x, ni abre `iureditor://iurefficient/doc`.
Sus instaladores de Windows y macOS son `.zip` sin firma.

## Estado (2026-11-28)

Se tomaron las opciones recomendadas de «Decisiones del dueño» (1: la 2.0 toma nombre,
identificador y clave; 2: migración por el actualizador de la 1.x; 3: se pierden tema y zoom; 4:
SignPath y notarización desde las rc, si están los secretos). Hecho en `egui/` (2.0.0-rc.1):

- binario `iureditor`, app id `iureditor`, icono de la 1.x (ventana y `.exe`); datos en
  `iureditor2` (como las alfas);
- `.github/workflows/release-2.yml` (etiquetas `v2.*`; `release.yml` queda para `v1.*`): compila
  `egui/` y empaqueta con `tauri bundle` y `egui/bundle/tauri.conf.json` sobre la configuración de
  la 1.x → AppImage, `.deb`, `.rpm`, NSIS, `.app`/`.dmg`/`.app.tar.gz` con los nombres, el
  esquema, las asociaciones y las `.sig` de la 1.x, y `latest.json`. Con guion (`-rc.N`) sale
  preliminar; sin guion, «Latest»;
- actualizador propio (`updates.rs`): semver de verdad, firma minisign con `KEY_8F1B`, instala
  AppImage, `.deb`/`.rpm` (pkexec), NSIS (`/P /R`) y `.app`;
- migración al primer arranque (`migrate.rs`): recientes, sesión y borradores; aviso de bienvenida;
- `iureditor://iurefficient/doc`.

Pendiente: abrir archivos y enlaces por Apple Events en macOS, diccionarios incluidos en
Windows/macOS, dependencias de WebKit que `tauri bundle` agrega al `.deb`/`.rpm` (inofensivas) y
el GTK dentro del AppImage (más pesado), fases 2–5.

## La idea

En la versión final, la 2.0 **ocupa el lugar de la 1.x**: mismo nombre de programa (`iureditor`),
mismo identificador de app, mismos formatos de instalador y la misma clave de firma. Así:

- el actualizador de cada 1.x instalada recibe la 2.0.0 como una actualización más (la 1.x instala
  AppImage, `.deb`/`.rpm`, el instalador NSIS de Windows y el `.app.tar.gz` de macOS, firmados con
  `KEY_8F1B`), sin publicar una 1.x puente;
- iureapps la instala y la actualiza sin cambios de fondo;
- IureDesk e IureProject la encuentran y le mandan sus enlaces sin cambios.

## Fases

### 1. La 2.0 lista para reemplazar (repo IureEditor)

1. **Nombre e identidad**: en la 2.0.0 el binario pasa a `iureditor`, el producto a «IureEditor», el
   app id/bundle id a `com.ellaguno.iureditor` (el de la 1.x) y la carpeta de datos se conserva
   (`iureditor2` solo durante las alfas). En Windows, el mismo nombre en «Agregar o quitar
   programas» (`iureditor`), para que el instalador reemplace a la 1.x.
2. **Instaladores como los de la 1.x**, con los mismos nombres
   (`iureditor_<ver>_{3-linux-x64|1-windows-x64|2-macos-universal}.<ext>`):
   - Linux: AppImage, `.deb` y `.rpm`, con `.desktop` que registra `MimeType=text/markdown;` y
     `x-scheme-handler/iureditor`.
   - Windows: instalador NSIS (`-setup.exe`) que registra `iureditor://` y `.md`; firmado con
     SignPath como la 1.x.
   - macOS: `.app` universal firmado y notarizado, con `CFBundleURLTypes` (`iureditor`) y tipos de
     documento `.md`; publicado como `.dmg` y `.app.tar.gz`.
3. **Firma y manifiesto**: cada instalador con su `.sig` (minisign, clave `KEY_8F1B`, la del
   actualizador de la 1.x) y un `latest.json` con el formato del de la 1.x (`linux-x86_64`,
   `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`).
4. **Actualizador propio**: «Buscar actualizaciones» lee ese `latest.json`, verifica la firma e
   instala (como la 1.x), y compara versiones con semver de verdad (corrige `alpha.10` < `alpha.6`).
5. **Migración al primer arranque** (una vez, sin borrar nada de la 1.x):
   - recientes (`recent.json`, clave `recentFiles`) y borradores (plugin-store) de
     `com.ellaguno.iureditor`;
   - plantillas (ya las lee) y diccionario personal;
   - tema, zoom y corrector viven en el `localStorage` del webview: se leen si es viable; si no, se
     pierden (aviso en las notas).
6. **Lo que falta de paridad**: `iureditor://iurefficient/doc`, diccionarios incluidos en Windows y
   macOS, ayuda (F1) propia, y lo que quede de la lista de `plan-2.0.md`.

### 2. Canal de prueba (antes de reemplazar)

- **2.0.0-rc.N** con todo lo anterior, publicadas como versión normal pero **sin** «Latest» y con
  nombre de binario final: las instalan a mano el dueño y quien pruebe (sobre una 1.x, para probar
  el reemplazo y la migración).
- Prueba de la actualización real: una 1.x apuntada a un `latest.json` de prueba (variable de
  entorno o compilación de prueba) instala la rc y abre los archivos y enlaces de siempre.

### 3. Lanzamiento

- **v2.0.0** (etiqueta `v2.0.0`, sin el prefijo `egui-`, para que iureapps lea bien la versión)
  como **«Latest»**, con su `latest.json`. Desde ese momento:
  - cada 1.x se actualiza a la 2.0 en su próxima comprobación (a los 6 s de abrir o desde el menú);
  - iureapps instala la 2.0 a quien la instale de cero.
- Las notas de la 1.x no se ven en su diálogo de actualización (solo muestra la versión): el aviso
  de «cambió de aspecto» va en la propia 2.0, en su primer arranque.

### 4. Apps hermanas e iureapps

- Con el binario `iureditor` y el esquema registrado, IureDesk e IureProject no cambian.
- Por si alguien conserva una alfa: agregar `iureditor2` como candidato en `iurefficient-connect`
  (`apps.rs`) y en `Bins` de IureDesk (`suite.rs`) mientras existan alfas instaladas.
- iureapps: que `Release::version()` quite también `egui-v` (por las alfas) y, opcional, soporte
  `.zip`; con los instaladores de la fase 1 no hace falta más.

### 5. Retiro de la 1.x

- La 1.19.2 queda descargable en Releases; `src-tauri/` y el frontend web pasan a una rama
  `1.x` y salen de `main`.
- Marcha atrás: no hay vuelta automática a la 1.x (el actualizador de la 2.0 no baja de versión); un
  fallo grave se corrige con una 2.0.x.

## Decisiones del dueño

1. ¿La 2.0 final toma el nombre, identificador y clave de la 1.x para reemplazarla en su lugar
   (recomendado), o se instala aparte y se avisa a los usuarios?
2. ¿Migración automática por el actualizador de la 1.x (recomendado) o aviso para descargarla a
   mano?
3. ¿Qué debe tener la 2.0 para dar el paso (la lista de paridad de `plan-2.0.md` más esta)? ¿Se
   aceptan perder tema y zoom de la 1.x si no se pueden leer?
4. ¿Firma con SignPath (Windows) y notarización de Apple como la 1.x desde las rc?
