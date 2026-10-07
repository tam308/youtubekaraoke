import { useState, type FormEvent } from 'react';
import { LIMITS } from '../../shared/constants';
import { KaraokeProvider, useKaraoke } from '../shared-ui/KaraokeContext';
import { NowPlaying } from '../shared-ui/NowPlaying';
import { SongBrowser } from '../shared-ui/SongBrowser';
import { ConnectionBanner, Toasts } from '../shared-ui/Toasts';
import { VolumePanel } from './VolumePanel';

const NICK_KEY = 'karaokeNickname';

function loadNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICK_KEY, name);
  } catch {
    /* private mode: name lasts for this visit only */
  }
}

export function MobileApp() {
  const [nickname, setNickname] = useState(loadNickname);
  if (!nickname) return <NicknameGate onDone={(n) => (saveNickname(n), setNickname(n))} />;
  return (
    <KaraokeProvider auth={{ nickname }}>
      <GuestScreen nickname={nickname} onRename={(n) => (saveNickname(n), setNickname(n))} />
    </KaraokeProvider>
  );
}

function NicknameGate({ onDone, initial = '' }: { onDone: (name: string) => void; initial?: string }) {
  const [name, setName] = useState(initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.replace(/\s+/g, ' ').trim();
    if (n) onDone(n);
  }
  return (
    <form className="nickname-gate" onSubmit={submit}>
      <img className="gate-logo" src="/icon-192.png" alt="" />
      <h1>Let's sing!</h1>
      <p className="muted">What's your name? It's shown next to the songs you add.</p>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={LIMITS.maxNicknameLength} autoFocus enterKeyHint="go" />
      <button className="btn primary" disabled={!name.trim()}>
        Join the party
      </button>
    </form>
  );
}

function GuestScreen({ nickname, onRename }: { nickname: string; onRename: (n: string) => void }) {
  const { send } = useKaraoke();
  const [renaming, setRenaming] = useState(false);

  if (renaming) {
    return (
      <NicknameGate
        initial={nickname}
        onDone={(n) => {
          onRename(n);
          void send({ type: 'session:setNickname', nickname: n });
          setRenaming(false);
        }}
      />
    );
  }

  return (
    <div className="mobile">
      <header className="m-header">
        <div className="m-top">
          <span className="brand">
            <img className="brand-icon" src="/icon-32.png" alt="" /> Karaoke
          </span>
          <button className="btn small ghost" onClick={() => setRenaming(true)} title="Change your name">
            {nickname} (change name)
          </button>
        </div>
        <ConnectionBanner guestHint />
        <NowPlaying />
      </header>
      <main className="m-body">
        <SongBrowser tabPosition="bottom" extraTab={{ label: 'Volume', content: <VolumePanel /> }} />
      </main>
      <Toasts />
    </div>
  );
}
