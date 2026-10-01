// Simulated Tauri backend so the real iureditor frontend runs in a plain
// browser for the README screenshots. Nothing here ships with the app.
//
// URL parameters (app.html?...):
//   lang=en|es      UI language and which demo documents to open
//   docs=0          start with a single empty tab (for the hero GIF)
//   active=<name>   file name of the tab to show first
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { DIR, DOCS } from './docs';

const params = new URLSearchParams(location.search);
const lang = params.get('lang') === 'es' ? 'es' : 'en';
const withDocs = params.get('docs') !== '0';
const docs = DOCS[lang];
const files = new Map(Object.entries(docs).map(([name, md]) => [`${DIR}/${name}`, md]));
const active = params.get('active');

mockWindows('main');

const stores = new Map<number, string>();
let nextRid = 1;
const storeGet = (path: string, key: string): [unknown, boolean] => {
  if (path === 'session.json' && key === 'openTabs' && withDocs) {
    return [
      {
        paths: [...files.keys()],
        activePath: active ? `${DIR}/${active}` : [...files.keys()][0],
        workspace: DIR,
        lastDir: DIR,
        cursors: {},
      },
      true,
    ];
  }
  return [null, false];
};

const fileInfo = (isDir: boolean) => ({
  isFile: !isDir, isDirectory: isDir, isSymlink: false, size: 1024,
  mtime: Date.now(), atime: Date.now(), birthtime: Date.now(), readonly: false,
  fileAttributes: null, dev: 0, ino: 0, mode: 0o644, nlink: 1, uid: 1000, gid: 1000,
  rdev: 0, blksize: 4096, blocks: 1,
});

mockIPC(
  (cmd, args: any) => {
    switch (cmd) {
      case 'ui_language':
      case 'get_ui_language_pref':
      case 'set_ui_language':
        return lang;
      case 'get_cli_file':
      case 'get_cli_iure_doc':
      case 'allow_asset_dir':
        return null;
      case 'apps_status':
        return [];
      case 'iure_status':
        return { loggedIn: false };
      case 'plugin:app|version':
        return '1.9.2';
      case 'plugin:path|resolve_directory':
        return '/home/demo/.local/share/com.ellaguno.iureditor';
      case 'plugin:path|join':
        return (args.paths as string[]).join('/').replace(/\/+/g, '/');
      case 'plugin:path|dirname':
        return String(args.path).replace(/\/[^/]*$/, '');
      case 'plugin:path|basename':
        return String(args.path).split('/').pop();
      case 'plugin:store|load':
      case 'plugin:store|get_store': {
        const rid = nextRid++;
        stores.set(rid, args.path);
        return rid;
      }
      case 'plugin:store|get':
        return storeGet(stores.get(args.rid) ?? '', args.key);
      case 'plugin:store|keys':
      case 'plugin:store|values':
      case 'plugin:store|entries':
        return [];
      case 'plugin:store|has':
        return false;
      case 'plugin:fs|read_text_file': {
        const md = files.get(String(args.path));
        if (md === undefined) throw new Error(`not found: ${args.path}`);
        return Array.from(new TextEncoder().encode(md));
      }
      case 'plugin:fs|exists':
        // The templates folder "exists" (and is empty) so nothing is written.
        return files.has(String(args.path)) || String(args.path) === 'templates' || String(args.path) === DIR;
      case 'plugin:fs|stat':
      case 'plugin:fs|lstat':
        return fileInfo(String(args.path) === DIR);
      case 'plugin:fs|read_dir':
        if (String(args.path) === DIR) {
          return [...files.keys()].map((p) => ({
            name: p.split('/').pop(), isFile: true, isDirectory: false, isSymlink: false,
          }));
        }
        return [];
      default:
        // window/webview/event/dialog/updater calls: nothing to do.
        return null;
    }
  },
  { shouldMockEvents: true }
);

await import('/src/main.tsx');
