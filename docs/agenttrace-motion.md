# AgentTrace motion demo (docs/agenttrace-motion.mp4)

1920×1080, 30 fps, H.264 + AAC, 98.8 s, mastered to -14 LUFS. Built programmatically: HTML/CSS scenes rendered frame-by-frame with Playwright, encoded with ffmpeg. Source: `scripts/motion-video/`.

## Scenes
| Time | Scene |
| --- | --- |
| 0:00 | Logo reveal, "Every agent leaves a trace." |
| 0:06 | Problem: agents act, nobody can check (real mainnet execution ids) |
| 0:15 | Blocked call: Treasury Agent #002 `demo_withdraw` → `FunctionNotAllowed(2, 0x1664Be58…11C3, 0x441a3e70)`; also `TransactionValueTooHigh`, `POLICY_REJECTED`, WMON `withdraw` |
| 0:26 | Pipeline for WMON Agent #003: Identity → Firewall → Execution → Proof → Outcome → ERC-8004, real hashes |
| 0:48 | Live mainnet captures: landing, /firewalls/3, /outcomes/0x30985cb6… |
| 0:58 | Verify a proof yourself: real PASS for 0x52c98d50… (captured on the live site) |
| 1:09 | SDK: `npm install agenttrace-monad viem`, `traceCall` |
| 1:20 | Why Monad: 179,045 gas anchorProof, 154,784 gas execute, ~600 ms finality; live stats strip read from the site at render time |
| 1:32 | Close: logo, URL, repo, npm, Track 04 |

## Rebuild
`scripts/motion-video/build.sh` (captures fresh from the live site, synthesizes narration, renders, mixes, muxes).

## Audio credits and licenses
- Narration: Piper TTS (MIT) with the `en_US-ryan-high` voice, trained on the RyanSpeech dataset, licensed CC BY-NC-SA 4.0 (non-commercial use; this is a non-commercial hackathon demo). edge-tts was unavailable (service returned HTTP 403).
- SFX (clicks, ticks, whooshes, pings, thud, chords) and the ambient drone bed: synthesized from scratch in `audio.py` with numpy. Original work, released CC0. No third-party samples or music.
- Fonts: Instrument Sans and IBM Plex Mono (SIL Open Font License), loaded from Google Fonts.
