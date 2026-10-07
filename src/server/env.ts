import sea from 'node:sea';

declare const __APP_VERSION__: string | undefined;

/** True when running as the packaged single-executable app. */
export const IS_SEA: boolean = (() => {
  try {
    return sea.isSea();
  } catch {
    return false;
  }
})();

export const IS_DEV = process.argv.includes('--dev');

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : (process.env.npm_package_version ?? '0.0.0-dev');
