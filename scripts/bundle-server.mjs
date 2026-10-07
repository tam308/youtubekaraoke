// Bundles the server (and the build-time playlist snapshot script) into single CommonJS
// files, as required by Node's single-executable-application feature. Called by build.py.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = process.env.APP_VERSION || pkg.version;

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  logLevel: 'warning',
  legalComments: 'none',
  define: { __APP_VERSION__: JSON.stringify(version) },
};

await Promise.all([
  build({ ...common, entryPoints: ['src/server/main.ts'], outfile: 'out/server.cjs' }),
  build({ ...common, entryPoints: ['src/server/playlists/fetchSnapshot.ts'], outfile: 'out/fetch-playlists.cjs' }),
]);

console.log(`Bundled server v${version} -> out/server.cjs, out/fetch-playlists.cjs`);
