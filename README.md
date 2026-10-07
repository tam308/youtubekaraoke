# YouTube Karaoke

A karaoke app for Windows and Mac that uses YouTube as its song library. Play songs from the computer, or turn on **Party mode** and let everyone add songs from their phones by scanning a QR code. No installer, no account, no API key.

## Getting started

**Windows:** run `YouTubeKaraoke.exe` (put it anywhere, for example your Desktop or a USB stick).
- "Windows protected your PC"? Click **More info**, then **Run anyway**. It appears once, because the app isn't code-signed.
- If your antivirus blocks it, restore it and add an exclusion (see [Troubleshooting](#troubleshooting)).

**Mac:** use `YouTube-Karaoke-Mac-Apple-Silicon.zip` for M1 to M4 Macs, or `YouTube-Karaoke-Mac-Intel.zip` for older Intel Macs (Apple menu > About This Mac shows which). macOS 13.5 or newer.
1. Unzip it and drag **YouTube Karaoke** into Applications.
2. The first time, macOS blocks it: open **System Settings > Privacy & Security** and click **Open Anyway**.
3. If macOS asks to allow incoming network connections, or to let YouTube Karaoke control Chrome, click **Allow** / **OK**.

The app opens in your own browser (Chrome, Edge or Brave) as a window without tabs, so your ad blocker works there too. Close the window to quit.

**Sound:** browsers only play sound after one click in the window. If a song starts muted, click anywhere.

## Local mode (just this computer)

- **Left side:** what's playing, pause, volume, and tabs for **Search**, **Playlists** and **Queue**. Press **+ Add** to queue a song, or **Next** to play it straight after the current one. Drag **⋮⋮** to reorder, **✕** to remove.
- **Right side:** the video, with who queued it and what's up next.
- Drag the line between the two sides to resize. **Tab** hides the controls for a bigger video.

## Party mode (phones join over Wi-Fi)

1. Click **Party mode** (or press **M**).
2. The first time, click **Allow phones**, then **Yes** when Windows asks. This lets phones past the firewall.
3. Guests scan the QR code. Their phone must be on the same Wi-Fi or hotspot as the computer.

The video fills the screen. Move the mouse and a **menu button** appears in the top-left corner. It has what's playing (pause, volume, skip), **Songs**, **QR code**, **Settings**, **Change YouTube video settings**, **Local mode** and **Exit**.

**On the phone:** enter your name, then use the tabs at the bottom: **Search**, **Playlists**, **Queue** (reorder, remove) and **Volume** (louder / quieter). **Skip** is at the top. Everyone sees changes instantly. If Party mode is turned off, phones show "Disconnected": refresh the page once it's back on.

## Playlists

Open **Playlists**, tap one, and add songs one at a time, several with **Select**, or at random. One playlist is built in. To add your own, press **Manage**, paste a public or unlisted YouTube playlist link, and press **Preview**, then **Save playlist**.

## Video quality and YouTube's controls

YouTube's own controls (pause bar, title, gear) are hidden so they never sit on top of the video. To change the quality, choose **Change YouTube video settings** (party menu, or under what's playing in Local mode), then click the gear at the bottom right of the video. YouTube's controls switch off again after **10 seconds**, or when you click **Click here when done**.

## Songs that open in a YouTube window

About 1 in 4 popular songs (often major-label music) can't play inside other apps because the owner blocks it. They still play on youtube.com, so when that happens the app opens the song in a fullscreen YouTube window and closes it when the song ends.
- Paused it? Press **+30 seconds** so it doesn't close early. **Next song** closes it straight away.
- To skip such songs instead: **Settings > Playback**.

## Keyboard shortcuts

**Space** pause, **N** next song, **M** switch mode, **Q** QR code, **Tab** hide controls (Local mode), **F** fullscreen, **S** settings, **Esc** close a dialog.

## Troubleshooting

**Phones can't connect**
- On the QR screen, click **Allow phones through the firewall** if it's shown.
- The phone must be on the same Wi-Fi or hotspot as the computer (not mobile data). PC on Ethernet and phone on Wi-Fi from the same router works too.
- If the computer is on several networks, pick the one the phone is on under the QR code.
- Antivirus with its own firewall (Norton, McAfee, Bitdefender, Avast, Kaspersky, ESET): allow `YouTubeKaraoke.exe` in it and mark your network as private/trusted. The QR screen's **Phone can't connect?** section shows the steps for the one you have.
- School, office or hotel Wi-Fi often blocks this; use a hotspot instead.

**Antivirus blocks the app:** it's a false alarm caused by the app being new and unsigned. Restore it from your antivirus's quarantine/history and add the app's folder as an exclusion.

**Search doesn't work:** check your internet connection.

**Your data:** queue, settings and playlists are saved in a `KaraokeData` folder next to the exe (on a Mac: `~/Library/Application Support/YouTube Karaoke`). The log file in there helps if something goes wrong.

## Build it yourself

On Windows with Python 3.10 or newer:

```
py build.py
```

Everything else (Node.js and the build tools) is downloaded automatically. The Windows exe and both Mac apps appear in `releases v<version>/` next to this folder. `py build.py --target win` builds only the Windows exe.

---

Not affiliated with YouTube or Google. Songs play through YouTube's official player; nothing is downloaded.
