import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { log } from '../log';

// A long-running PowerShell process with a small Win32 helper compiled once, driven by a
// line protocol. Starting PowerShell + compiling C# takes ~1 s, far too slow to repeat
// every second while watching a pop-up window, so one process is kept alive and reused.
const CSHARP = `
using System; using System.Runtime.InteropServices; using System.Text; using System.Diagnostics;
public static class KWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool altTab);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")] static extern uint GetWindowPid(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  static string TitleOf(IntPtr h) {
    int n = GetWindowTextLength(h);
    if (n == 0) return "";
    var sb = new StringBuilder(n + 1);
    GetWindowText(h, sb, n + 1);
    return sb.ToString().Replace("\\t", " ").Replace("\\u001e", " ");
  }
  static string ProcessOf(IntPtr h) {
    uint pid;
    GetWindowPid(h, out pid);
    try { return Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { return ""; }
  }
  // Visible top-level windows as "hwnd<TAB>process<TAB>title" records separated by \\u001e.
  public static string List() {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      string t = TitleOf(h);
      if (t.Length > 0) sb.Append(h.ToInt64()).Append('\\t').Append(ProcessOf(h)).Append('\\t').Append(t).Append('\\u001e');
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  public static string Title(long h) {
    var w = new IntPtr(h);
    return IsWindow(w) && IsWindowVisible(w) ? "1\\t" + TitleOf(w) : "0\\t";
  }
  static bool Focus(IntPtr w) {
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fg, true);
    SetForegroundWindow(w);
    BringWindowToTop(w);
    AttachThreadInput(me, fg, false);
    System.Threading.Thread.Sleep(250);
    if (GetForegroundWindow() == w) return true;
    // Second route: the Alt+Tab switcher API is allowed in some cases SetForegroundWindow isn't.
    SwitchToThisWindow(w, true);
    System.Threading.Thread.Sleep(300);
    return GetForegroundWindow() == w;
  }
  // Maximise, focus, and press F (YouTube's fullscreen shortcut).
  public static string Fullscreen(long h) {
    var w = new IntPtr(h);
    if (!IsWindow(w)) return "gone";
    ShowWindow(w, 3);
    if (!Focus(w)) return "nofocus";
    keybd_event(0x46, 0, 0, UIntPtr.Zero);
    keybd_event(0x46, 0, 2, UIntPtr.Zero);
    return "ok";
  }
  public static string Close(long h) {
    PostMessage(new IntPtr(h), 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
    return "ok";
  }
}`;

const LOOP = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ', 2); $arg = if ($p.Length -gt 1) { $p[1] } else { '' }
  try {
    $out = switch ($p[0]) {
      'list' { [KWin]::List() }
      'title' { [KWin]::Title([long]$arg) }
      'fullscreen' { [KWin]::Fullscreen([long]$arg) }
      'close' { [KWin]::Close([long]$arg) }
      default { 'ERR unknown' }
    }
  } catch { $out = 'ERR ' + $_.Exception.Message }
  [Console]::Out.WriteLine([string]$out); [Console]::Out.Flush()
}`;

export interface WindowInfo {
  hwnd: string;
  /** Lower-case process name, e.g. "chrome". */
  process: string;
  title: string;
}

/** Windows-only window control. All methods resolve to null when unavailable. */
export class WinHelper {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<boolean> | null = null;
  private pending: Array<(line: string | null) => void> = [];
  private chain: Promise<unknown> = Promise.resolve();

  get supported(): boolean {
    return process.platform === 'win32';
  }

  private start(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LOOP], { windowsHide: true });
      this.proc = proc;
      const rl = readline.createInterface({ input: proc.stdout });
      let isReady = false;
      rl.on('line', (line) => {
        if (!isReady) {
          if (line.trim() === 'READY') {
            isReady = true;
            resolve(true);
          }
          return;
        }
        this.pending.shift()?.(line);
      });
      proc.on('exit', () => {
        log.warn('Window helper exited');
        if (!isReady) resolve(false);
        for (const p of this.pending.splice(0)) p(null);
        this.proc = null;
        this.ready = null;
      });
      proc.on('error', () => resolve(false));
      setTimeout(() => !isReady && resolve(false), 20_000);
    });
    return this.ready;
  }

  /** Send one command and wait for its single-line reply (commands are serialised). */
  private send(cmd: string): Promise<string | null> {
    const task = this.chain.then(async () => {
      if (!this.supported || !(await this.start()) || !this.proc) return null;
      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 10_000);
        this.pending.push((line) => {
          clearTimeout(timer);
          resolve(line);
        });
        this.proc!.stdin.write(cmd + '\n');
      });
    });
    this.chain = task.catch(() => undefined);
    return task;
  }

  async list(): Promise<WindowInfo[] | null> {
    const out = await this.send('list');
    if (out === null || out.startsWith('ERR')) return null;
    return out
      .split('\u001e')
      .filter(Boolean)
      .map((rec) => {
        const [hwnd, process, ...rest] = rec.split('\t');
        return { hwnd: hwnd!, process: process ?? '', title: rest.join('\t') };
      });
  }

  /** null = helper unavailable; { open: false } = the window is gone. */
  async title(hwnd: string): Promise<{ open: boolean; title: string } | null> {
    const out = await this.send(`title ${hwnd}`);
    if (out === null || out.startsWith('ERR')) return null;
    const [flag, ...rest] = out.split('\t');
    return { open: flag === '1', title: rest.join('\t') };
  }

  fullscreen(hwnd: string): Promise<string | null> {
    return this.send(`fullscreen ${hwnd}`);
  }

  close(hwnd: string): Promise<string | null> {
    return this.send(`close ${hwnd}`);
  }

  dispose(): void {
    this.proc?.kill();
  }
}
