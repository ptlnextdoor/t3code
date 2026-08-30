# On-device screen capture: macOS + Windows (2026 brief)

## Viable approaches

### macOS

| Approach                                           | Status                                                  | Notes                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ScreenCaptureKit `SCStream`** (macOS 12.3+)      | Current, recommended                                    | GPU-composited `CMSampleBuffer` frames, per-display/window/app filters, `minimumFrameInterval` throttling, `queueDepth`, `excludingApplications` for redaction, dirty-rect skipping (no frame delivered when nothing changed). Best for video/timelapse. |
| **`SCScreenshotManager.captureImage`** (macOS 14+) | Current, recommended for low cadence                    | One-shot capture with an `SCContentFilter` + `SCStreamConfiguration`; no long-lived stream, no persistent purple/menu-bar recording indicator churn. What Dayflow uses.                                                                                  |
| **`CGWindowListCreateImage` / `CGDisplayStream`**  | **Deprecated in macOS 14** in favor of ScreenCaptureKit | Still functional, but Apple gates it behind the same TCC Screen Recording grant since macOS 10.15 and has been degrading it (returns desktop-picture-only images without consent). Do not build new code on it.                                          |
| `AVCaptureScreenInput`                             | Legacy AVFoundation path                                | Superseded by SCK; fewer filtering/exclusion controls.                                                                                                                                                                                                   |

Permission model: single TCC `kTCCServiceScreenCapture` grant ("Screen & System Audio Recording"), user-granted in System Settings, requires app relaunch on first grant. Since macOS 15 the system re-prompts periodically (weekly/monthly) unless the app is a properly signed, non-transient install; audit-token-stable, notarized builds keep the grant. Probe with `CGPreflightScreenCaptureAccess()` / `SCShareableContent` failure rather than assuming.

### Windows

| Approach                                                    | Status               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows.Graphics.Capture (WGC)** — Win10 1803+            | Current, recommended | `GraphicsCaptureItem` from picker **or** programmatically via `IGraphicsCaptureItemInterop::CreateForMonitor/CreateForWindow` (Win32 desktop apps only). Handles DWM composition, occlusion, per-window capture, DPI changes, HDR. `IsCursorCaptureEnabled` (1903+), `IsBorderRequired=false` requires the restricted capability `graphicsCaptureWithoutBorder` (Store-approved apps) — otherwise a yellow border is drawn around captured content. |
| **Desktop Duplication API (DXGI `IDXGIOutputDuplication`)** | Current, low-level   | Per-display only, zero-copy D3D11 textures, dirty/move rects, highest throughput. Fails/needs re-init on mode change, session switch, UAC secure desktop, and when a fullscreen exclusive DX app takes over; must run in the user's interactive session (not a service). No permission prompt, no capture indicator.                                                                                                                                |
| **GDI `BitBlt` / `PrintWindow`**                            | Legacy fallback      | Simple, works everywhere including RDP-ish paths, but CPU-bound, misses hardware overlays and DRM-protected surfaces (black frames), poor on multi-monitor/DPI, and no dirty-rect info. Use only as a last-resort fallback.                                                                                                                                                                                                                         |

Windows has **no OS consent gate** for DDA/BitBlt, and WGC's gate is UI-level (picker + border), not a TCC-style permission. Apps can be excluded from capture by setting `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`; honor it, do not defeat it.

## Battery + privacy tradeoffs

- **Cadence dominates cost.** A 1-shot capture every 5-30s scaled to ~1080p and JPEG-encoded is on the order of tens of ms of CPU per shot — effectively free at idle. A continuous 30-60 fps `SCStream` or DDA loop holds the GPU/display pipeline awake and is the difference between "invisible" and "fan on / hours of battery".
- **On macOS prefer `SCScreenshotManager` at low cadence over a persistent `SCStream`**: a live stream keeps the capture engine, an encoder, and often the discrete GPU resident, and pins the menu-bar recording indicator continuously.
- If you need video, still use SCK with `minimumFrameInterval` set to your real target (e.g. 1-2 fps) and rely on SCK's "no frame when nothing changed" behavior; encode with VideoToolbox/HEVC hardware encoders, never software.
- **On Windows prefer WGC over DDA for a background journaler**: WGC frames arrive only on change, DDA's `AcquireNextFrame` loop plus your own timeout handling is easy to get wrong and burn a core. DDA wins only for high-fps game/remote-desktop streaming.
- **Downscale before encode.** Capturing at native 5K and then scaling costs far more memory bandwidth than asking the API for a 1920x1080 target (`SCStreamConfiguration.width/height`, WGC `FramePool.Recreate` at target size).
- Privacy: exclude sensitive apps at the source, not after the fact. SCK's `SCContentFilter(display:excludingApplications:)` and window exclusion mean secret windows never enter your process's memory. Windows lacks a symmetric per-app exclusion for the capturer, so you must detect the foreground window and drop/redact the frame yourself, which is a strictly weaker guarantee.
- Idle detection (`CGEventSource.secondsSinceLastEventType` on macOS, `GetLastInputInfo` on Windows) lets you skip captures entirely while the user is away — the single biggest battery win.
- Screen-lock, display-sleep, and system-sleep notifications must stop capture; otherwise you capture the lock screen and waste power.

### What Dayflow actually does (per its public repo)

- **API:** ScreenCaptureKit only — `SCScreenshotManager.captureImage(contentFilter:configuration:)` per shot, no `SCStream`. Requires macOS 14+ and the "Screen & System Audio Recording" grant (`ScreenRecordingPermissionView` in onboarding).
- **Cadence:** a `DispatchSourceTimer` fires every `ScreenshotConfig.interval`, default **10 seconds**, overridable via the `screenshotIntervalSeconds` user default. It records `idleSecondsAtCapture` from `CGEventSource.secondsSinceLastEventType(.hidSystemState, ...)` alongside every frame.
- **Quality/format:** scaled to `targetHeight = 1080` preserving aspect (even dimensions for later H.264 muxing), `scalesToFit = true`, cursor shown, **JPEG at quality 0.85**. Frames are later stitched into timelapse video by `VideoProcessingService`.
- **Multi-display:** an `ActiveDisplayTracker` follows the focused display and only that display is captured (one `SCDisplay`, not all screens).
- **Privacy posture:** `RecordingPrivacyPreferences` seeds a default blocklist of credential apps (1Password, Bitwarden, Keychain Access, LastPass, Proton Pass, Ledger Live, Trezor, YubiKey Authenticator, ...). Blocked apps are excluded via `SCContentFilter(display:excludingApplications:exceptingWindows:)`, and if a blocked app is _frontmost_ the whole frame is replaced by a synthesized placeholder JPEG (`RecordingPrivacyPlaceholder`) rather than captured at all.
- **Storage:** local-only, `~/Library/Application Support/Dayflow/` — JPEGs on disk plus a GRDB/SQLite `chunks.sqlite`. `StorageManager+Maintenance` runs a purge timer with configurable byte caps, **default 10 GB recordings + 10 GB timelapses**, "unlimited" disables purging.
- **Distribution:** direct DMG + Homebrew cask, **not** the Mac App Store; `Dayflow.entitlements` sets `com.apple.security.app-sandbox = false` (it does use hardened runtime + Sparkle updates). That is the pragmatic answer to the sandbox question below.
- **Cloud posture:** analysis provider is user-chosen (Ollama/LM Studio local, or Gemini/ChatGPT/Claude with the user's own key/CLI); only in the cloud case do frames leave the machine.

### App Store / sandbox constraints (macOS)

- ScreenCaptureKit **is** usable from a sandboxed app, but the TCC Screen Recording grant is orthogonal to the sandbox and cannot be pre-granted by entitlement.
- The painful part is not capture, it's persistence: a sandboxed MAS app writing a growing on-disk corpus, running a login-item background recorder, shelling out to `ffmpeg`, and talking to arbitrary localhost LLM servers all collide with App Review. Every serious always-on recorder (Dayflow, Rewind, screenpipe) ships **outside the App Store, unsandboxed, notarized + hardened runtime + Sparkle**. Plan for direct distribution unless you deliberately gut the feature set.
- If you must sandbox: you get container-scoped storage only (`~/Library/Containers/...`), need `com.apple.security.network.client` for cloud providers, and `SMAppService` for the login item.

## What to vendor vs build

**Build yourself (thin, platform-native, ~1-2k LOC per platform):**

- The capture loop and cadence/idle/lock policy. This is where all the battery and correctness value is, it is small, and every off-the-shelf library gets the policy wrong for your product.
- The privacy filter (app blocklist → `SCContentFilter` exclusions / foreground-app redaction). Security-critical, must be auditable, must not be a dependency you can't read.
- Storage schema + retention/purge. SQLite (GRDB on macOS, `rusqlite`/`Microsoft.Data.Sqlite` elsewhere) with JPEG/segment files on disk, byte-capped.

**Vendor / don't reinvent:**

- **Encoding:** VideoToolbox (macOS) and Media Foundation / `IMFSinkWriter` (Windows) hardware encoders; or ship a pinned FFmpeg binary if you need broad container support. Never write an H.264 encoder.
- **Windows WGC plumbing:** use Microsoft's `Windows.Graphics.Capture` sample / `windows-capture` (Rust) or `SharpDX`/`Windows.Graphics.Capture.Interop` bindings for the frame-pool + D3D device dance and the interop `CreateForMonitor` path — it is fiddly and well-solved.
- **Cross-platform reference:** `mediar-ai/screenpipe` (MIT, Rust) already abstracts SCK + WGC behind one capture trait; read it even if you don't depend on it. Dayflow is the best-in-class reference for _policy_ (cadence, redaction, retention) on macOS specifically.
- **Updates/crash reporting:** Sparkle (macOS), Squirrel/MSIX (Windows), Sentry. Do not build.

**Do not vendor:** any "universal screen capture" wrapper that hides the permission state machine. You need first-class access to permission-denied, display-changed, and session-locked events, and wrappers reliably swallow them.

## Risks

1. **macOS TCC re-prompt churn.** macOS 15+ periodically re-asks for Screen Recording consent; an unsigned, ad-hoc-signed, or frequently-relocated binary re-prompts constantly and users churn. Mitigation: Developer ID signature, notarization, stable install location, `/Applications` only.
2. **CGWindowList deprecation.** Anything still on `CGWindowListCreateImage`/`CGDisplayStream` is on borrowed time (deprecated macOS 14) and already returns degraded output without consent. Treat removal as a when, not if. Also SCK raised the floor to macOS 12.3, and `SCScreenshotManager` to macOS 14 — pick your minimum deliberately.
3. **Sandbox/App Store rejection** for always-on recording, background login items, and bundled binaries. Budget for direct distribution; do not architect around a MAS release you may never get.
4. **Windows capture indicator/border policy.** Removing the WGC yellow border needs a restricted capability that non-Store apps effectively cannot get; a persistent border around the whole desktop is a product-killer, so validate the UX early or accept DDA (no border, but no consent UI either — a legal/ethics exposure).
5. **DDA fragility:** breaks on resolution/DPI change, session lock/switch, UAC secure desktop, GPU driver reset, and exclusive-fullscreen games. Requires a robust re-initialize loop or you silently stop recording.
6. **DRM/protected content:** Netflix, some banking and DRM'd windows return black frames or are excluded (`WDA_EXCLUDEFROMCAPTURE`, HDCP paths). Detect all-black frames and don't store megabytes of nothing.
7. **Disk growth and thermals.** At 10s cadence, 1080p q0.85 JPEG (~200-400 KB) is ~1-3 GB/day of active use. Byte-capped purging is mandatory, as is skipping capture when idle.
8. **Data-at-rest exposure.** Plaintext JPEGs of a user's entire screen are the highest-value target on the machine; passwords, 2FA codes, and health data will be in there. Blocklists are best-effort, not a guarantee. Consider FileVault dependence, per-file encryption, and a clearly documented delete path.
9. **Cloud-provider egress surprise.** If any analysis backend is remote, that is a full-screen-content disclosure. Make it opt-in, per-provider, and visible in the UI (Dayflow's model is a good template).
10. **Multi-display and virtual displays** (Sidecar, DisplayLink, headless VMs) produce zero-size or transient `SCDisplay`/monitor handles; cache invalidation on display reconfiguration is a common crash/stall source.

## Sources

- Dayflow repo (README, `Core/Recording/ScreenRecorder.swift`, `RecordingPrivacyPreferences.swift`, `StoragePreferences.swift`, `StorageManager+Maintenance.swift`, `Dayflow.entitlements`) — https://github.com/JerryZLiu/Dayflow
- Apple, ScreenCaptureKit framework — https://developer.apple.com/documentation/screencapturekit
- Apple, `SCScreenshotManager` (macOS 14.0+) — https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager
- Apple, `SCStreamConfiguration` (`minimumFrameInterval`, `queueDepth`, `width`/`height`) — https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration
- Apple, `SCContentFilter` (display/app/window exclusion) — https://developer.apple.com/documentation/screencapturekit/sccontentfilter
- Apple, `CGWindowListCreateImage` (deprecated macOS 14) — https://developer.apple.com/documentation/coregraphics/cgwindowlistcreateimage(_:_:_:_:)
- Apple, `CGRequestScreenCaptureAccess` / `CGPreflightScreenCaptureAccess` — https://developer.apple.com/documentation/coregraphics/cgrequestscreencaptureaccess()
- Apple, App Sandbox — https://developer.apple.com/documentation/security/app-sandbox
- Microsoft, Screen capture (Windows.Graphics.Capture, picker + yellow border) — https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture
- Microsoft, `GraphicsCaptureSession` (`IsBorderRequired`, `IsCursorCaptureEnabled`, `IsSupported`) — https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession
- Microsoft, `IGraphicsCaptureItemInterop` (picker-free capture for Win32) — https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nn-windows-graphics-capture-interop-igraphicscaptureiteminterop
- Microsoft, Desktop Duplication API — https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api
- Microsoft, `IDXGIOutputDuplication::AcquireNextFrame` — https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutputduplication-acquirenextframe
- Microsoft, `BitBlt` — https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-bitblt
- Microsoft, `SetWindowDisplayAffinity` (`WDA_EXCLUDEFROMCAPTURE`) — https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity
- Microsoft, Win32CaptureSample reference implementation — https://github.com/microsoft/Windows.UI.Composition-Win32-Samples
- screenpipe (cross-platform SCK + WGC capture in Rust) — https://github.com/mediar-ai/screenpipe
