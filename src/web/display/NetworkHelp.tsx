import { useState } from 'react';
import { useKaraoke } from '../shared-ui/KaraokeContext';

interface SecurityGuide {
  match: RegExp;
  name: string;
  allow: string[];
  quickTest: string;
}

/** Where to let phones through, per security program. Menu names vary a little between versions. */
const GUIDES: SecurityGuide[] = [
  {
    match: /norton/i,
    name: 'Norton',
    allow: [
      'Open Norton and go to Settings, then Firewall.',
      'On the General Settings tab, find Network Trust and set your current network (for example your hotspot) to Private or Full Trust.',
      'On the Program Control tab, click Add, pick YouTubeKaraoke.exe and set it to Allow.',
    ],
    quickTest: 'Right-click the Norton icon near the clock and choose Disable Smart Firewall for 15 minutes.',
  },
  {
    match: /mcafee/i,
    name: 'McAfee',
    allow: [
      'Open McAfee and go to My Protection, then Firewall.',
      'Open Internet connections for programs (or Ports and system services), add YouTubeKaraoke.exe and give it full access, incoming and outgoing.',
    ],
    quickTest: 'My Protection, Firewall, then Turn off for 15 minutes.',
  },
  {
    match: /bitdefender/i,
    name: 'Bitdefender',
    allow: [
      'Open Bitdefender and go to Protection, then Firewall, then Settings.',
      'On the Rules tab, add a rule for YouTubeKaraoke.exe that allows incoming connections.',
      'On the Networks tab, set your current network to Home/Office.',
    ],
    quickTest: 'Protection, then switch Firewall off.',
  },
  {
    match: /avast|avg/i,
    name: 'Avast / AVG',
    allow: [
      'Open the app and go to Protection, then Firewall (called Enhanced Firewall in AVG).',
      'Open Application rules, add YouTubeKaraoke.exe and allow it.',
      'Set your current network to Private.',
    ],
    quickTest: 'Protection, Firewall, then switch it off for 10 minutes.',
  },
  {
    match: /kaspersky/i,
    name: 'Kaspersky',
    allow: [
      'Go to Settings, Security settings, then Firewall.',
      'Under Application rules, find YouTubeKaraoke.exe and set its network access to Allow.',
      'Under Networks, set your current network to Trusted or Local network.',
    ],
    quickTest: 'Settings, Security settings, then switch Firewall off.',
  },
  {
    match: /eset/i,
    name: 'ESET',
    allow: [
      'Open ESET and go to Setup, then Network protection.',
      'Open the Firewall settings and add a rule that allows incoming TCP connections for YouTubeKaraoke.exe.',
      'Under Connected networks, set the current network to Home or office network.',
    ],
    quickTest: 'Setup, Network protection, then pause the Firewall.',
  },
  {
    match: /windows defender|microsoft defender|windows firewall/i,
    name: 'Windows Security (built in)',
    allow: [
      'Click Allow phones through the firewall above. That adds the rule for you.',
      'Or by hand: Windows Security, Firewall & network protection, Allow an app through firewall, then tick YouTubeKaraoke.exe for both Private and Public.',
    ],
    quickTest: 'Windows Security, Firewall & network protection, click your active network, then turn Microsoft Defender Firewall off.',
  },
];

function GuideSteps({ guide }: { guide: SecurityGuide }) {
  return (
    <div className="guide">
      <ol>
        {guide.allow.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="hint">
        Quick test: {guide.quickTest} If phones connect while it's off, the firewall was the problem. Turn it back on afterwards and allow the app
        instead.
      </p>
    </div>
  );
}

/** The firewall in charge on this PC: a third-party one if registered, otherwise Windows Security. */
function activeGuide(firewalls: string[]): { product: string; guide: SecurityGuide } {
  for (const product of firewalls) {
    const guide = GUIDES.find((g) => g.match.test(product));
    if (guide) return { product, guide };
  }
  if (firewalls[0]) return { product: firewalls[0], guide: { match: /.*/, name: firewalls[0], allow: [`Open ${firewalls[0]} and allow incoming connections for YouTubeKaraoke.exe in its firewall settings, and mark your current network as private/trusted.`], quickTest: `Turn off the firewall in ${firewalls[0]} for a few minutes.` } };
  return { product: 'Windows Security', guide: GUIDES[GUIDES.length - 1]! };
}

/** macOS: the built-in firewall is off by default; when on, it asks once per app. */
function MacSecurityHelp() {
  return (
    <div className="security-help">
      <p>
        <strong>Firewall on this Mac: macOS firewall.</strong> If macOS asked "Do you want the application YouTube Karaoke to accept incoming
        network connections?", the answer must be Allow.
      </p>
      <div className="guide">
        <ol>
          <li>Open System Settings, then Network, then Firewall.</li>
          <li>If the firewall is on, click Options and make sure YouTube Karaoke is set to Allow incoming connections.</li>
          <li>Make sure "Block all incoming connections" is turned off.</li>
        </ol>
        <p className="hint">
          Security apps with their own firewall (for example Norton or Intego) need YouTube Karaoke allowed in their settings too. Quick test: turn
          the firewall off for a few minutes; if phones connect, that was the cause (turn it back on afterwards).
        </p>
      </div>
    </div>
  );
}

/** Explains which firewall can block phones on this PC and exactly where to allow the app. */
export function SecurityHelp() {
  const { hostInfo } = useKaraoke();
  if (hostInfo?.platform === 'darwin') return <MacSecurityHelp />;
  const firewalls = hostInfo?.security?.firewall ?? [];
  const { product, guide } = activeGuide(firewalls);
  const others = GUIDES.filter((g) => g !== guide);
  return (
    <div className="security-help">
      <p>
        <strong>Firewall on this PC: {product}.</strong>{' '}
        {firewalls.length > 0
          ? `${product} decides which devices may connect, so allowing the app in Windows alone is not enough. Allow it in ${product}:`
          : 'To let phones connect:'}
      </p>
      <GuideSteps guide={guide} />
      <details className="help">
        <summary>Using a different antivirus?</summary>
        {others.map((g) => (
          <div key={g.name}>
            <strong>{g.name}</strong>
            <GuideSteps guide={g} />
          </div>
        ))}
      </details>
    </div>
  );
}

/** Warns when Windows Firewall will block phones, with a one-click fix (shows a UAC prompt). */
export function FirewallStatus() {
  const { hostInfo, send, notify } = useKaraoke();
  const [busy, setBusy] = useState(false);
  if (!hostInfo) return null;
  const thirdParty = hostInfo.security?.firewall ?? [];

  async function allow() {
    setBusy(true);
    const ack = await send({ type: 'firewall:allow' }, 130_000);
    setBusy(false);
    if (!ack.ok) notify(ack.error, 'error');
  }

  return (
    <>
      {hostInfo.firewallRule === false && (
        <div className="callout warn">
          <strong>Windows Firewall will probably block phones.</strong>
          <p>
            Hotspots and most Wi-Fi networks count as Public in Windows, which blocks incoming connections. Allow the app once (Windows asks for
            permission). The rule only covers this app, its party ports and your local network.
          </p>
          <button className="btn small primary" onClick={allow} disabled={busy}>
            {busy ? 'Waiting for Windows...' : 'Allow phones through the firewall'}
          </button>
        </div>
      )}
      {hostInfo.firewallRule === true && thirdParty.length === 0 && <p className="hint ok-text">Phones are allowed through Windows Firewall.</p>}
      {thirdParty.length > 0 && (
        <div className="callout warn">
          <strong>{thirdParty.join(', ')} controls the firewall on this PC.</strong>
          <p>If phones can't connect, allow YouTube Karaoke in {thirdParty[0]} too. See "Phone can't connect?" below for the exact steps.</p>
        </div>
      )}
    </>
  );
}

/** Lets the host pick which network address the QR code points at. */
export function NetworkPicker() {
  const { hostInfo, send, notify } = useKaraoke();
  if (!hostInfo || hostInfo.adapters.length < 2) return null;
  const s = hostInfo.settings;
  return (
    <label className="field">
      <span>Phones on a different network? Pick the one they're connected to:</span>
      <select
        value={s.lanAddress ?? ''}
        onChange={async (e) => {
          const ack = await send({ type: 'settings:update', patch: { lanAddress: e.target.value || null } });
          if (!ack.ok) notify(ack.error, 'error');
        }}
      >
        <option value="">
          Automatic ({hostInfo.adapters[0]!.name}, {hostInfo.adapters[0]!.address})
        </option>
        {hostInfo.adapters.map((a) => (
          <option key={a.address} value={a.address}>
            {a.name}, {a.address}
          </option>
        ))}
      </select>
    </label>
  );
}
