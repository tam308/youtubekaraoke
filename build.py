#!/usr/bin/env python3
"""Build YouTube Karaoke for Windows and macOS: one command, one portable app per platform.

    py build.py                     # everything -> "../releases v<major>/win" and ".../mac"
    py build.py --target win        # only the Windows exe (fastest)
    py build.py --target mac        # only the two Mac apps (Apple Silicon + Intel)
    py build.py --skip-tests        # skip typecheck + unit tests
    py build.py --clean             # wipe out/ first (build cache)
    py build.py --version 2.1.0     # stamp a version into package.json and the apps
    py build.py --zip               # also zip the Windows exe
    py build.py --out-dir DIR       # put the builds somewhere else
    py build.py --no-playlist-snapshot   # offline build: presets load on first run instead

Requirements: Python 3.10+ (standard library only). Everything else is downloaded into
.tools/ automatically (pinned versions, checksum-verified): Node.js for this machine, the
Node.js macOS binaries the Mac apps are built from, and rcodesign (signs Mac apps from any OS).
The Windows exe can only be built on Windows; the Mac apps can be built on any OS.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

NODE_VERSION = "24.21.0"
RCODESIGN_VERSION = "0.29.0"
ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / ".tools"
OUT = ROOT / "out"
# Builds go next to the source folder, one folder per major version, e.g. <project>/releases v2/{win,mac}/
# (older versions' folders are left alone). Set in main() once the version is known.
RELEASE = ROOT.parent / "releases"
LOCAL_ICONS = ROOT / "assets" / "local"
# --default-icon: ignore the personal icon (for builds that will be shared publicly).
USE_LOCAL_ICONS = True
EXE_NAME = "YouTubeKaraoke.exe"
MAC_APP_NAME = "YouTube Karaoke.app"
MAC_EXE_NAME = "YouTubeKaraoke"
MAC_BUNDLE_ID = "io.github.youtube-karaoke"
# Node 24's minimum supported macOS version.
MAC_MIN_OS = "13.5"
SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
ALL_TARGETS = ("win", "mac-arm64", "mac-x64")
MAC_ZIP_NAMES = {"mac-arm64": "YouTube-Karaoke-Mac-Apple-Silicon.zip", "mac-x64": "YouTube-Karaoke-Mac-Intel.zip"}

IS_WINDOWS = sys.platform == "win32"
NODE_DIR = TOOLS / "node"
NODE_EXE = NODE_DIR / ("node.exe" if IS_WINDOWS else "bin/node")
NPM_CLI = NODE_DIR / ("node_modules" if IS_WINDOWS else "lib/node_modules") / "npm" / "bin" / "npm-cli.js"


class BuildError(Exception):
    pass


# ---------------------------------------------------------------------------------------
# output helpers
# ---------------------------------------------------------------------------------------

_step_no = 0


def step(title: str) -> None:
    global _step_no
    _step_no += 1
    print(f"\n\033[1;35m[{_step_no}] {title}\033[0m", flush=True)


def info(msg: str) -> None:
    print(f"    {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"    \033[33mWARNING: {msg}\033[0m", flush=True)


def env_with_node() -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = str(NODE_EXE.parent) + os.pathsep + env.get("PATH", "")
    return env


def run(args: list[str], what: str, env: dict[str, str] | None = None, check: bool = True) -> int:
    """Run a command, streaming its output. Raises BuildError naming the step on failure."""
    proc = subprocess.run(args, cwd=ROOT, env=env or env_with_node())
    if check and proc.returncode != 0:
        raise BuildError(f"{what} failed (exit code {proc.returncode}). See the output above.")
    return proc.returncode


def npm(*args: str, what: str, env: dict[str, str] | None = None) -> None:
    run([str(NODE_EXE), str(NPM_CLI), *args], what, env)


def node(*args: str, what: str, env: dict[str, str] | None = None, check: bool = True) -> int:
    return run([str(NODE_EXE), *args], what, env, check)


def download(url: str, what: str) -> bytes:
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            return r.read()
    except OSError as e:
        raise BuildError(f"Could not download {what} ({e}). Check your internet connection.") from e


def node_shasums() -> str:
    return download(f"https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt", "Node.js checksums").decode()


def verified(data: bytes, expected: str | None, what: str) -> bytes:
    if not expected or hashlib.sha256(data).hexdigest() != expected:
        raise BuildError(f"Downloaded {what} failed its checksum check. Try again.")
    return data


# ---------------------------------------------------------------------------------------
# toolchain
# ---------------------------------------------------------------------------------------


def host_node_archive() -> str:
    arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    if IS_WINDOWS:
        return f"node-v{NODE_VERSION}-win-x64.zip"
    if sys.platform == "darwin":
        return f"node-v{NODE_VERSION}-darwin-{arch}.tar.gz"
    return f"node-v{NODE_VERSION}-linux-{arch}.tar.xz"


def ensure_node() -> None:
    step(f"Preflight: Node.js {NODE_VERSION}")
    if NODE_EXE.exists():
        out = subprocess.run([str(NODE_EXE), "--version"], capture_output=True, text=True).stdout.strip()
        if out == f"v{NODE_VERSION}":
            info(f"Using {NODE_EXE.relative_to(ROOT)} ({out})")
            return
        info(f"Found {out}, but this build pins v{NODE_VERSION}; replacing it.")
        shutil.rmtree(NODE_DIR)

    archive = host_node_archive()
    info(f"Downloading {archive} from nodejs.org ...")
    sums = node_shasums()
    expected = next((line.split()[0] for line in sums.splitlines() if line.endswith(archive)), None)
    data = verified(download(f"https://nodejs.org/dist/v{NODE_VERSION}/{archive}", "Node.js"), expected, "Node.js")
    info("Checksum OK, extracting ...")
    TOOLS.mkdir(exist_ok=True)
    folder = archive.removesuffix(".zip").removesuffix(".tar.gz").removesuffix(".tar.xz")
    if archive.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(TOOLS)
    else:
        with tarfile.open(fileobj=io.BytesIO(data)) as t:
            t.extractall(TOOLS)
    (TOOLS / folder).rename(NODE_DIR)
    info(f"Installed portable Node.js to {NODE_DIR.relative_to(ROOT)}")


def ensure_mac_node(arch: str) -> Path:
    """The official Node.js macOS binary for `arch` (arm64 / x64), the base of the Mac app."""
    target = TOOLS / "mac-node" / arch / "node"
    if target.exists():
        return target
    archive = f"node-v{NODE_VERSION}-darwin-{arch}.tar.gz"
    info(f"Downloading {archive} from nodejs.org ...")
    expected = next((line.split()[0] for line in node_shasums().splitlines() if line.endswith(archive)), None)
    data = verified(download(f"https://nodejs.org/dist/v{NODE_VERSION}/{archive}", f"Node.js for macOS ({arch})"), expected, "Node.js for macOS")
    member = f"{archive.removesuffix('.tar.gz')}/bin/node"
    with tarfile.open(fileobj=io.BytesIO(data)) as t:
        src = t.extractfile(member)
        if src is None:
            raise BuildError(f"{member} missing from {archive}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(src.read())
    return target


def ensure_rcodesign() -> Path:
    """rcodesign signs macOS apps from any OS (Apple's codesign only runs on a Mac)."""
    exe = TOOLS / "rcodesign" / ("rcodesign.exe" if IS_WINDOWS else "rcodesign")
    if exe.exists():
        return exe
    if IS_WINDOWS:
        asset = f"apple-codesign-{RCODESIGN_VERSION}-x86_64-pc-windows-msvc.zip"
    elif sys.platform == "darwin":
        asset = f"apple-codesign-{RCODESIGN_VERSION}-macos-universal.tar.gz"
    else:
        asset = f"apple-codesign-{RCODESIGN_VERSION}-x86_64-unknown-linux-musl.tar.gz"
    base = f"https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F{RCODESIGN_VERSION}"
    info(f"Downloading rcodesign {RCODESIGN_VERSION} ...")
    expected = download(f"{base}/{asset}.sha256", "rcodesign checksum").decode().split()[0]
    data = verified(download(f"{base}/{asset}", "rcodesign"), expected, "rcodesign")
    exe.parent.mkdir(parents=True, exist_ok=True)
    name = exe.name
    if asset.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            member = next(n for n in z.namelist() if n.endswith("/" + name))
            exe.write_bytes(z.read(member))
    else:
        with tarfile.open(fileobj=io.BytesIO(data)) as t:
            member = next(m for m in t.getmembers() if m.name.endswith("/" + name))
            exe.write_bytes(t.extractfile(member).read())  # type: ignore[union-attr]
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return exe


def ensure_deps() -> None:
    step("Dependencies")
    lock = ROOT / "package-lock.json"
    marker = ROOT / "node_modules" / ".lock-hash"
    want = hashlib.sha256(lock.read_bytes()).hexdigest() if lock.exists() else ""
    if marker.exists() and marker.read_text().strip() == want:
        info("node_modules is up to date (skipping npm ci)")
        return
    info("Installing packages (npm ci) ...")
    npm("ci", "--no-audit", "--no-fund", what="npm ci")
    marker.write_text(want)


# ---------------------------------------------------------------------------------------
# shared build steps
# ---------------------------------------------------------------------------------------


def checks() -> None:
    step("Checks: typecheck + unit tests")
    npm("run", "typecheck", what="Typecheck")
    # Unit tests live in tests/, which isn't part of the public repo; run them when present.
    if (ROOT / "tests").is_dir():
        npm("test", what="Unit tests")
    else:
        info("No tests/ folder: skipping unit tests")


def icon_file(suffix: str) -> Path:
    """Personal icon in assets/local/ (gitignored) if present, else the default one."""
    local = LOCAL_ICONS / f"icon{suffix}"
    return local if USE_LOCAL_ICONS and local.exists() else ROOT / "assets" / f"icon{suffix}"


def build_web(env: dict[str, str]) -> None:
    step("Web UI (vite build)")
    npm("run", "build:web", what="Web UI build", env=env)
    local_pngs = sorted(LOCAL_ICONS.glob("icon-*.png")) if USE_LOCAL_ICONS else []
    for png in local_pngs:
        shutil.copyfile(png, OUT / "web" / png.name)
    if local_pngs:
        info(f"Using your personal icon from {LOCAL_ICONS.relative_to(ROOT)} ({len(local_pngs)} images)")


def build_server(env: dict[str, str]) -> None:
    step("Server bundle (esbuild)")
    npm("run", "build:server", what="Server bundle", env=env)


def playlist_snapshot(skip: bool) -> Path | None:
    step("Built-in playlist snapshot")
    target = OUT / "playlists-snapshot.json"
    target.unlink(missing_ok=True)
    if skip:
        info("Skipped (--no-playlist-snapshot). Presets will load from YouTube on first launch.")
        return None
    code = node(str(OUT / "fetch-playlists.cjs"), str(target), what="Playlist snapshot", check=False)
    if code == 1 or not target.exists():
        warn("Could not fetch the built-in playlists (offline?). Building without a snapshot;")
        warn("presets will load from YouTube on first launch instead.")
        target.unlink(missing_ok=True)
        return None
    if code == 2:
        warn("Some built-in playlists failed to fetch; they will load on first launch.")
    return target


def sea_blob(snapshot: Path | None, name: str, code_cache: bool) -> Path:
    """Package server + web UI into a SEA blob. Code cache is platform-specific, so blobs for
    another OS (the Mac apps, when building on Windows) are made without it."""
    web = OUT / "web"
    assets = {f"web/{p.relative_to(web).as_posix()}": str(p) for p in sorted(web.rglob("*")) if p.is_file()}
    if snapshot:
        assets["playlists-snapshot.json"] = str(snapshot)
    blob = OUT / f"{name}.blob"
    config = {
        # Relative to ROOT (the working directory): Node stores this path inside the app, and an
        # absolute one would carry the builder's user name and folders into every release.
        "main": (OUT / "server.cjs").relative_to(ROOT).as_posix(),
        "output": str(blob),
        "disableExperimentalSEAWarning": True,
        "useCodeCache": code_cache,
        "useSnapshot": False,
        "assets": assets,
    }
    cfg = OUT / f"sea-config-{name}.json"
    cfg.write_text(json.dumps(config, indent=2))
    node("--experimental-sea-config", str(cfg), what="Creating the SEA blob")
    return blob


def inject(binary: Path, blob: Path, macho: bool) -> None:
    extra = ["--macho-segment-name", "NODE_SEA"] if macho else []
    node(
        str(ROOT / "node_modules" / "postject" / "dist" / "cli.js"),
        str(binary), "NODE_SEA_BLOB", str(blob), "--sentinel-fuse", SEA_FUSE, *extra,
        what="Injecting the app (postject)",
    )


def write_sha256(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    (path.parent / f"{path.name}.sha256").write_text(f"{digest}  {path.name}\n")
    return digest


# ---------------------------------------------------------------------------------------
# Windows
# ---------------------------------------------------------------------------------------


def strip_pe_signature(exe: Path) -> None:
    """Remove node.exe's Authenticode signature (it becomes invalid once we modify the file)."""
    data = bytearray(exe.read_bytes())
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", data, opt)[0]
    dirs = opt + (112 if magic == 0x20B else 96)
    sec_entry = dirs + 4 * 8  # IMAGE_DIRECTORY_ENTRY_SECURITY
    offset, size = struct.unpack_from("<II", data, sec_entry)
    if not offset:
        return
    struct.pack_into("<II", data, sec_entry, 0, 0)
    if offset + size >= len(data) - 8:  # certificate table sits at the end of the file
        del data[offset:]
    exe.write_bytes(bytes(data))


def set_gui_subsystem(exe: Path) -> None:
    """Mark the exe as a Windows GUI app so no console window appears."""
    with exe.open("r+b") as f:
        f.seek(0x3C)
        pe = struct.unpack("<I", f.read(4))[0]
        f.seek(pe + 24 + 68)  # OptionalHeader.Subsystem
        f.write(struct.pack("<H", 2))  # IMAGE_SUBSYSTEM_WINDOWS_GUI


def build_windows(snapshot: Path | None, version: str, make_zip: bool) -> None:
    step("Windows: YouTubeKaraoke.exe")
    blob = sea_blob(snapshot, "app-win", code_cache=True)
    out_dir = RELEASE / "win"
    out_dir.mkdir(parents=True, exist_ok=True)
    exe = out_dir / EXE_NAME
    try:
        exe.unlink(missing_ok=True)
    except PermissionError as e:
        raise BuildError(f"{exe.name} is still running. Close the karaoke window (or click Exit) and build again.") from e
    shutil.copyfile(NODE_EXE, exe)
    strip_pe_signature(exe)

    rcedit = ROOT / "node_modules" / "rcedit" / "bin" / "rcedit-x64.exe"
    win_version = ".".join((re.findall(r"\d+", version) + ["0"] * 4)[:4])
    run(
        [
            str(rcedit), str(exe),
            "--set-icon", str(icon_file(".ico")),
            "--set-file-version", win_version,
            "--set-product-version", win_version,
            "--set-version-string", "ProductName", "YouTube Karaoke",
            "--set-version-string", "FileDescription", "YouTube Karaoke",
            "--set-version-string", "CompanyName", "YouTube Karaoke contributors",
            "--set-version-string", "OriginalFilename", EXE_NAME,
            "--set-version-string", "InternalName", "YouTubeKaraoke",
            # Blank, otherwise the exe shows node.exe's own copyright line.
            "--set-version-string", "LegalCopyright", " ",
        ],
        "Setting the icon and version info (rcedit)",
    )
    inject(exe, blob, macho=False)
    set_gui_subsystem(exe)
    digest = write_sha256(exe)
    info(f"{exe}  ({exe.stat().st_size / 1_048_576:.1f} MB)  SHA-256 {digest[:16]}...")
    if make_zip:
        z = out_dir / f"YouTubeKaraoke-Windows-{version}.zip"
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            zf.write(exe, exe.name)
        info(f"{z}  ({z.stat().st_size / 1_048_576:.1f} MB)")


# ---------------------------------------------------------------------------------------
# macOS
# ---------------------------------------------------------------------------------------


def strip_macho_signature(path: Path) -> None:
    """Remove the code signature from a thin 64-bit Mach-O (what `codesign --remove-signature` does)."""
    data = bytearray(path.read_bytes())
    magic, _cpu, _sub, _ftype, ncmds, sizeofcmds, _flags, _res = struct.unpack_from("<IiiIIIII", data, 0)
    if magic != 0xFEEDFACF:
        raise BuildError(f"{path.name} is not a thin 64-bit Mach-O binary")
    off, sig, linkedit = 32, None, None
    for _ in range(ncmds):
        cmd, cmdsize = struct.unpack_from("<II", data, off)
        if cmd == 0x1D:  # LC_CODE_SIGNATURE
            sig = (off, cmdsize, *struct.unpack_from("<II", data, off + 8))
        elif cmd == 0x19 and data[off + 8 : off + 24].rstrip(b"\0") == b"__LINKEDIT":  # LC_SEGMENT_64
            linkedit = off
        off += cmdsize
    if not sig:
        return
    cmd_off, cmd_size, dataoff, _datasize = sig
    end = 32 + sizeofcmds
    data[cmd_off:end] = data[cmd_off + cmd_size : end] + b"\0" * cmd_size
    struct.pack_into("<II", data, 16, ncmds - 1, sizeofcmds - cmd_size)
    if linkedit is not None:
        if linkedit > cmd_off:
            linkedit -= cmd_size
        vmaddr, _vmsize, fileoff, _filesize = struct.unpack_from("<QQQQ", data, linkedit + 24)
        new_filesize = dataoff - fileoff
        new_vmsize = (new_filesize + 0x3FFF) // 0x4000 * 0x4000
        struct.pack_into("<QQQQ", data, linkedit + 24, vmaddr, new_vmsize, fileoff, new_filesize)
    del data[dataoff:]
    path.write_bytes(bytes(data))


def mac_info_plist(version: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>YouTube Karaoke</string>
  <key>CFBundleExecutable</key><string>{MAC_EXE_NAME}</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleIdentifier</key><string>{MAC_BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>YouTube Karaoke</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>{version}</string>
  <key>CFBundleVersion</key><string>{version}</string>
  <key>LSMinimumSystemVersion</key><string>{MAC_MIN_OS}</string>
  <!-- No Dock icon or menu bar: the app is a background server; its window is the browser. -->
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSLocalNetworkUsageDescription</key><string>Lets phones on your Wi-Fi join the karaoke party.</string>
  <!-- Needed for the macOS permission prompt; without it the request is silently refused. -->
  <key>NSAppleEventsUsageDescription</key><string>Lets YouTube Karaoke close the YouTube window when a song ends, and notice when you close it.</string>
</dict>
</plist>
"""


def zip_mac_app(app: Path, dest: Path) -> None:
    """Zip a .app keeping Unix permissions (the executable bit), so it runs after unzipping on a Mac."""
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in sorted([app, *app.rglob("*")]):
            arc = p.relative_to(app.parent).as_posix()
            if p.is_dir():
                zi = zipfile.ZipInfo(arc + "/", time.localtime(p.stat().st_mtime)[:6])
                zi.create_system = 3
                zi.external_attr = (0o40755 << 16) | 0x10
                zf.writestr(zi, b"")
            else:
                zi = zipfile.ZipInfo(arc, time.localtime(p.stat().st_mtime)[:6])
                zi.create_system = 3
                mode = 0o100755 if p.parent.name == "MacOS" else 0o100644
                zi.external_attr = mode << 16
                zi.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(zi, p.read_bytes())


def build_mac(arch_target: str, blob: Path, version: str, rcodesign: Path) -> None:
    arch = arch_target.removeprefix("mac-")
    label = "Apple Silicon" if arch == "arm64" else "Intel"
    step(f"macOS ({label}): {MAC_APP_NAME}")
    base_node = ensure_mac_node(arch)

    stage = OUT / arch_target
    shutil.rmtree(stage, ignore_errors=True)
    app = stage / MAC_APP_NAME
    (app / "Contents" / "MacOS").mkdir(parents=True)
    (app / "Contents" / "Resources").mkdir(parents=True)
    binary = app / "Contents" / "MacOS" / MAC_EXE_NAME
    shutil.copyfile(base_node, binary)
    strip_macho_signature(binary)
    inject(binary, blob, macho=True)
    (app / "Contents" / "Info.plist").write_text(mac_info_plist(version), encoding="utf-8")
    shutil.copyfile(icon_file(".icns"), app / "Contents" / "Resources" / "icon.icns")

    # Macs refuse to run unsigned code; an ad-hoc signature (no Apple account) is enough to run.
    run([str(rcodesign), "sign", str(app)], "Signing the Mac app (rcodesign)")

    out_dir = RELEASE / "mac"
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / MAC_ZIP_NAMES[arch_target]
    dest.unlink(missing_ok=True)
    zip_mac_app(app, dest)
    digest = write_sha256(dest)
    info(f"{dest}  ({dest.stat().st_size / 1_048_576:.1f} MB)  SHA-256 {digest[:16]}...")


# ---------------------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------------------


def stamp_version(version: str | None) -> str:
    pkg_path = ROOT / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    if version:
        if not re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?", version):
            raise BuildError(f"--version must look like 1.2.3, got {version!r}")
        if pkg["version"] != version:
            pkg["version"] = version
            pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
            info(f"package.json version set to {version}")
    return pkg["version"]


def parse_targets(raw: str) -> list[str]:
    targets: list[str] = []
    for part in raw.split(","):
        part = part.strip()
        expanded = ["mac-arm64", "mac-x64"] if part == "mac" else list(ALL_TARGETS) if part == "all" else [part]
        for t in expanded:
            if t not in ALL_TARGETS:
                raise BuildError(f"Unknown target {t!r}. Use win, mac, mac-arm64, mac-x64 or all.")
            if t not in targets:
                targets.append(t)
    return targets


def main() -> int:
    parser = argparse.ArgumentParser(description="Build YouTube Karaoke for Windows and macOS")
    parser.add_argument("--target", default="all", help="win, mac, mac-arm64, mac-x64 or all (comma-separated; default all)")
    parser.add_argument("--skip-tests", action="store_true", help="skip typecheck and unit tests")
    parser.add_argument("--clean", action="store_true", help="delete the out/ build cache first")
    parser.add_argument("--version", help="stamp this version (e.g. 2.1.0) into package.json and the apps")
    parser.add_argument("--zip", action="store_true", help="also zip the Windows exe")
    parser.add_argument("--no-playlist-snapshot", action="store_true", help="don't bundle the built-in playlists (offline build)")
    parser.add_argument("--default-icon", action="store_true", help="use the default icon even if assets/local/ has a personal one (for public releases)")
    parser.add_argument("--out-dir", type=Path, help='where to put the builds (default: "../releases v<major version>")')
    args = parser.parse_args()
    global RELEASE, USE_LOCAL_ICONS
    if args.default_icon:
        USE_LOCAL_ICONS = False

    started = time.time()
    try:
        targets = parse_targets(args.target)
        if "win" in targets and not IS_WINDOWS:
            warn("The Windows exe can only be built on Windows; skipping it.")
            targets.remove("win")
        if not targets:
            raise BuildError("Nothing to build on this OS.")
        if args.clean:
            shutil.rmtree(OUT, ignore_errors=True)
        version = stamp_version(args.version)
        RELEASE = args.out_dir.resolve() if args.out_dir else ROOT.parent / f"releases v{version.split('.')[0]}"
        print(f"\033[1mBuilding YouTube Karaoke v{version} for: {', '.join(targets)}\033[0m")
        ensure_node()
        ensure_deps()
        if args.skip_tests:
            step("Checks: skipped (--skip-tests)")
        else:
            checks()
        env = env_with_node()
        env["APP_VERSION"] = version
        build_web(env)
        build_server(env)
        snapshot = playlist_snapshot(args.no_playlist_snapshot)

        if "win" in targets:
            build_windows(snapshot, version, args.zip)
        mac_targets = [t for t in targets if t.startswith("mac-")]
        if mac_targets:
            rcodesign = ensure_rcodesign()
            # Without code cache the blob is portable, so one blob serves both Mac architectures.
            blob = sea_blob(snapshot, "app-mac", code_cache=False)
            for t in mac_targets:
                build_mac(t, blob, version, rcodesign)
    except BuildError as e:
        print(f"\n\033[1;31mBUILD FAILED: {e}\033[0m", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        return 130
    print(f"\n\033[1;32mBuild succeeded in {time.time() - started:.0f}s\033[0m  ->  {RELEASE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
