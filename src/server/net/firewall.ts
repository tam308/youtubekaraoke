import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PORT_SCAN_RANGE } from '../../shared/constants';
import { log } from '../log';

const execFileAsync = promisify(execFile);
export const FIREWALL_RULE_NAME = 'YouTube Karaoke (party mode)';

/** PowerShell single-quoted string literal. */
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

let cache: { at: number; value: boolean | null } | null = null;

/**
 * Whether phones can get through Windows Firewall: our allow rule exists for *this* exe and
 * there is no Block rule for it. (When Windows shows its own "allow access" prompt and Public
 * is left unticked or Cancel is pressed, it silently creates Block rules, which beat Allow rules.)
 * Returns null when not on Windows or the check failed. Cached for 30 s (the query takes ~1 s).
 */
export async function hasFirewallRule(): Promise<boolean | null> {
  if (process.platform !== 'win32') return null;
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const script = [
    `$r = @(Get-NetFirewallApplicationFilter -Program ${psQuote(process.execPath)} -ErrorAction SilentlyContinue |`,
    `  Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' })`,
    `$ours = @($r | Where-Object { $_.DisplayName -eq ${psQuote(FIREWALL_RULE_NAME)} -and $_.Action -eq 'Allow' }).Count`,
    `$block = @($r | Where-Object { $_.Action -eq 'Block' }).Count`,
    `Write-Output "$ours $block"`,
  ].join('\n');
  let value: boolean | null = null;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 20_000,
    });
    const [ours, block] = stdout.trim().split(/\s+/).map(Number);
    value = (ours ?? 0) > 0 && (block ?? 0) === 0;
    if ((block ?? 0) > 0) log.warn(`Windows Firewall has ${block} Block rule(s) for this exe`);
  } catch (err) {
    log.warn('Firewall status check failed:', (err as Error).message.split('\n')[0]);
  }
  cache = { at: Date.now(), value };
  return value;
}

/**
 * Shows a UAC prompt, removes any existing inbound rules for this exe (including Windows'
 * auto-created Block rules), and adds one narrow Allow rule. Resolves true if phones are now allowed.
 */
export async function addFirewallRule(lanPort: number): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const exe = process.execPath.replace(/"/g, '');
  const ports = `${lanPort}-${lanPort + PORT_SCAN_RANGE}`;
  const fw = 'netsh advfirewall firewall';
  const cmd =
    `/c ${fw} delete rule name="${FIREWALL_RULE_NAME}" >nul 2>&1 & ` + // our rule from an older exe location
    `${fw} delete rule name=all dir=in program="${exe}" >nul 2>&1 & ` +
    `${fw} add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow enable=yes profile=any ` +
    `program="${exe}" protocol=TCP localport=${ports} remoteip=localsubnet ` +
    `description="Lets phones on your local network join YouTube Karaoke party mode."`;
  const ps = `Start-Process -FilePath cmd.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${psQuote(cmd)}`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 120_000 });
  } catch (err) {
    log.warn('Firewall rule not added (UAC cancelled or failed):', (err as Error).message.split('\n')[0]);
    return false;
  } finally {
    cache = null;
  }
  const ok = (await hasFirewallRule()) === true;
  log.info(ok ? 'Firewall rule added' : 'Firewall rule still missing after elevation');
  return ok;
}

export interface SecurityProducts {
  antivirus: string[];
  /** Third-party firewalls only (Windows' own firewall isn't listed here). */
  firewall: string[];
}

let productsCache: { at: number; value: SecurityProducts | null } | null = null;

/** Antivirus / firewall products registered with Windows Security Center (cached for 5 minutes). */
export async function listSecurityProducts(): Promise<SecurityProducts | null> {
  if (process.platform !== 'win32') return null;
  if (productsCache && Date.now() - productsCache.at < 5 * 60_000) return productsCache.value;
  const script = [
    `$av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object displayName)`,
    `$fw = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -ErrorAction SilentlyContinue | ForEach-Object displayName)`,
    `Write-Output (@{ antivirus = $av; firewall = $fw } | ConvertTo-Json -Compress)`,
  ].join('\n');
  let value: SecurityProducts | null = null;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 15_000,
    });
    const raw = JSON.parse(stdout.trim()) as { antivirus?: string[] | string; firewall?: string[] | string };
    const list = (v: string[] | string | undefined) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).filter(Boolean))];
    value = { antivirus: list(raw.antivirus), firewall: list(raw.firewall) };
  } catch (err) {
    log.warn('Security product check failed:', (err as Error).message.split('\n')[0]);
  }
  productsCache = { at: Date.now(), value };
  return value;
}
