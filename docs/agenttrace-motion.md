# AgentTrace motion film (docs/agenttrace-motion.mp4)

73 s · 1920×1080 · 60 fps · H.264 + AAC · mastered to -14.5 LUFS integrated, true peak -1.5 dBFS.

One continuous shot with no cuts (ffmpeg `scdet` finds no scene changes). A single trace of light leaves WMON Agent #003. The agent's first call (`withdraw`, 0x2e1a7d4d) stops at the firewall with `FunctionNotAllowed(3, 0x3bd3…5433A, 0x2e1a7d4d)` and nothing is sent. The allowed `deposit()` (0.01 MON) goes through and runs past its receipt fields (block 111,382,135, executor 0xB925D44d…4D4E, AgentFirewall, AgentAction, calldataHash, 14/14 receipt checks). The fields collapse into the real proofHash `0xcf38cf59…21c2de`, which falls into block 111,382,167 (`anchorProof`, 179,045 gas, tx 0x107ad29f…, final 2 blocks later). The trace then rises into the official ERC-8004 registry (identity #10315: `validationResponse` 100 0xec0b469a…, `giveFeedback` 100 0x8d0e94ff…). The camera pulls back to show the whole trace, then pushes into a fresh capture of the live mainnet site, where the trace types the execution id into "Verify a proof yourself" and gets a real PASS (rebuilt hash = onchain anchor). Finally it collapses into the AgentTrace logo.

All values are real: `scripts/verify-proof.mjs 0x30985cb6…` PASS and receipts read from rpc.monad.xyz on 13 Oct 2026. The site capture (stats 5 agents / 5 firewalls / 7 verified executions / 7 anchored proofs, block 112,987,705) was taken at render time.

## Voice (5 lines, 26 words)
1. "An agent acts." (0:01.6)
2. "Some calls never get through." (0:09.7)
3. "The ones that do leave a trace." (0:29.6)
4. "Written on-chain, for anyone to check." (0:46.6)
5. "AgentTrace. Live on Monad." (1:07.8)

Kokoro-82M (Apache-2.0), voice `af_heart`, via kokoro-onnx (MIT). No captions.

## Audio sources and licences
Music: "minimal ambient music/atmosphere fragment" by Clacksberg, freesound #495747, CC0. Ducked under the voice.

Freesound (all CC0 1.0, https://freesound.org/s/<id>/):
- 848212 JW_Audio "DSGNWhsh Whoosh, Futuristic, Synthetic, Pass-By": the call passing the firewall, the pull-back
- 486234 BennettFilmTeacher "Whoosh For Whip Zoom": the call launching, the rise to ERC-8004, the push into the site
- 423799 ch_ase "Little Whoosh 2": the hash collapsing, the dissolve
- 859482 BeaconStudio "Cinematic Riser #3 subtle": the risers into the firewall, the hash and the anchor
- 856174 brktkrgll "Subterranean Deep Sub-Bass Rumble Drop": the sub hit on the anchor, the logo
- 737284 qubodup "Key Locking Door": the lock on the blocked call
- 851556 TommasoMotteran "UI Menu Click Reverb - Soft Confirm Click": the opening dot
- 528561 Jummit "Soft UI Button Click": the Verify click

Kenney (CC0 1.0, kenney.nl): Interface Sounds (tick, click, select, confirmation, glass, maximize) for receipt rows, hash characters, block tiles, registry writes, id typing, PASS and the logo; Sci-Fi Sounds `forceField_000` for the firewall gate.

Every sound is placed at an event time exported by the renderer (`events.json`). Placements are listed in `cues.json`, and peak-aligned where marked.

Fonts: Instrument Sans and IBM Plex Mono (SIL OFL).

## Build
Run `scripts/motion-video/`: `node cap.mjs` (fresh captures) → `python3 vo.py` → `node render.mjs events` → `node render.mjs full 5` → `python3 audio.py` → `bash mix.sh` → concat the parts and mux with `tmix=frames=2` (a 2-frame motion-blur blend). Sounds are downloaded into `snd/` (Kenney zips, plus freesound previews found with `freesound_search.py`).
