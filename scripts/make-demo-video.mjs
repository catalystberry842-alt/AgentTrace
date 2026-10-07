// Builds docs/demo.mp4 from docs/demo-voiceover.md: one scene per "## n. Title" section.
// Narration: edge-tts (free, no account). Picture: Playwright recordings of the live mainnet app.
// Captions are burned in, timed by sentence length within each narration clip.
//
//   pip install edge-tts && node scripts/make-demo-video.mjs [baseUrl]
//   node scripts/make-demo-video.mjs --short [baseUrl]   -> docs/demo-short.mp4 from docs/demo-short-voiceover.md
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const SHORT = process.argv.includes("--short");
const BASE = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "https://agenttrace-mainnet.vercel.app";
const OUT = resolve(SHORT ? "docs/demo-short.mp4" : "docs/demo.mp4");
const VOICEOVER = SHORT ? "docs/demo-short-voiceover.md" : "docs/demo-voiceover.md";
const WORK = SHORT ? "/tmp/agenttrace-video-short" : "/tmp/agenttrace-video";
const VOICE = process.env.VOICE ?? "en-US-AndrewNeural";
const W = 1440;
const H = 900;
const EXEC = "0x52c98d5058fc9a180a5270aeea72698600f5c6c181d7723a1f503fcdab4c6d5e";

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const sections = readFileSync(VOICEOVER, "utf8")
  .split(/^## \d+\. /m)
  .slice(1)
  .map((block) => {
    const [title, ...rest] = block.trim().split("\n");
    return { title: title.trim(), text: rest.join(" ").replace(/\s+/g, " ").trim() };
  });

// MCP transcript rendered as a plain dark page (content is the real recorded session).
const transcript = readFileSync("docs/agent-runs/mcp-mainnet.md", "utf8");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function renderTranscript(md) {
  // Minimal Markdown: "## " headings become sections, ``` fences become code blocks.
  const out = [];
  let inCode = false;
  let section = 0;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(
        esc(line)
          .replace(/"allowed": true/g, '<span class="ok">"allowed": true</span>')
          .replace(/"receipt_verified"/g, '<span class="ok">"receipt_verified"</span>')
          .replace(/FIREWALL_REJECTED|FunctionNotAllowed\([^)]*\)/g, (m) => `<span class="no">${m}</span>`),
      );
      continue;
    }
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      section += 1;
      out.push(`<h2 id="call${section}">${esc(line.slice(3)).replace(/`([^`]+)`/g, "<code>$1</code>")}</h2>`);
      continue;
    }
    if (line.trim()) out.push(`<p>${esc(line.replace(/^> /, "")).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`);
  }
  return out.join("\n");
}
writeFileSync(
  join(WORK, "mcp.html"),
  `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0b0b0c;color:#cfcfcf;font:15px/1.6 system-ui,sans-serif}
  main{max-width:960px;margin:0 auto;padding:56px 48px 700px}
  h1{font-weight:500;font-size:22px;color:#f2f2f2;margin:0 0 4px}
  h2{font-weight:500;font-size:16px;color:#f2f2f2;margin:36px 0 6px;padding-top:20px;border-top:1px solid #222}
  .sub{color:#8a8a8a;font-size:13px;margin-bottom:24px}
  p{margin:6px 0;color:#a9a9a9} b{color:#c98a8a;font-weight:500}
  code{font:13px ui-monospace,Menlo,monospace;color:#e0e0e0}
  pre{font:13px/1.55 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all;background:#111113;border:1px solid #222;border-radius:4px;padding:14px 16px;margin:10px 0}
  .ok{color:#8eae96}.no{color:#d39a9a}
  </style><main><h1>AgentTrace MCP server · scripted client session</h1>
  <div class="sub">Monad mainnet · Treasury Agent #002 · firewall #002 · real transactions</div>
  ${renderTranscript(transcript)}</main>`,
);

// Scene picture: URL plus the text anchors to scroll to, spread across the narration.
const SCENES = SHORT ? [
  { url: `file://${WORK}/mcp.html`, anchors: ["#call3"] },
  { url: `file://${WORK}/mcp.html`, anchors: ["#call2"] },
  { url: "/firewalls/2", anchors: [null, "Allowed targets", "Allowed functions"] },
  { url: `/proofs/${EXEC}`, anchors: [null, "Verification", "Anchor"] },
  { url: `/proofs/${EXEC}`, anchors: ["Published to ERC-8004"] },
  { url: "/", anchors: [null, "Why an independent validator"] },
] : [
  { url: "/", anchors: [null, "How one agent action is checked"] },
  { url: "/agents/1", anchors: [null, "Public reputation"] },
  { url: "/firewalls/1", anchors: [null, "Allowed targets", "Allowed functions"] },
  { url: `/proofs/${EXEC}`, anchors: [null, "Verification", "Anchor"] },
  { url: `/proofs/${EXEC}`, anchors: ["Anchor", "Published to ERC-8004"] },
  { url: `/outcomes/${EXEC}`, anchors: [null] },
  { url: `file://${WORK}/mcp.html`, anchors: [null, "#call2", "#call3"] },
  { url: "/", anchors: ["Why an independent validator"] },
];
if (SCENES.length !== sections.length) throw new Error(`${sections.length} sections but ${SCENES.length} scenes`);

const seconds = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

function srtTime(t) {
  const ms = Math.round(t * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}

function captions(text, duration, lead) {
  // Split into sentences, then into chunks of at most ~90 characters for two-line captions.
  const chunks = [];
  for (const sentence of text.match(/[^.!?]+[.!?]+/g) ?? [text]) {
    const words = sentence.trim().split(" ");
    let line = "";
    for (const word of words) {
      if ((line + " " + word).trim().length > 84) {
        chunks.push(line.trim());
        line = "";
      }
      line += ` ${word}`;
    }
    if (line.trim()) chunks.push(line.trim());
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let t = lead;
  return chunks
    .map((chunk, i) => {
      const d = (chunk.length / total) * duration;
      const row = `${i + 1}\n${srtTime(t)} --> ${srtTime(t + d)}\n${chunk}\n`;
      t += d;
      return row;
    })
    .join("\n");
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });

// Warm the serverless instances so recordings show settled pages.
{
  const page = await browser.newPage();
  for (const scene of SCENES) {
    if (scene.url.startsWith("file://")) continue;
    await page.goto(BASE + scene.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
  }
  await page.close();
}

const LEAD = 0.6; // silence before narration
const TAIL = 0.9;
const parts = [];
for (let i = 0; i < sections.length; i++) {
  const { title, text } = sections[i];
  const scene = SCENES[i];
  const audio = join(WORK, `s${i}.mp3`);
  execFileSync("python3", ["-m", "edge_tts", "--voice", VOICE, "--rate", "+4%", "--text", text, "--write-media", audio]);
  const speech = seconds(audio);
  const duration = LEAD + speech + TAIL;

  const dir = join(WORK, `rec${i}`);
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(scene.url.startsWith("file://") ? scene.url : BASE + scene.url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(scene.url.startsWith("file://") ? 400 : 3500); // let data settle; trimmed below
  const firstAnchor = scene.anchors[0];
  const scrollTo = async (anchor) => {
    await page.evaluate((label) => {
      if (!label) return window.scrollTo({ top: 0, behavior: "smooth" });
      if (label.startsWith("#")) {
        const target = document.querySelector(label);
        if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 60, behavior: "smooth" });
        return;
      }
      const el = [...document.querySelectorAll("h1,h2,h3,p,dt,span,div")].find((node) => node.childElementCount <= 2 && node.textContent?.trim().startsWith(label));
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
    }, anchor);
  };
  if (firstAnchor) {
    await scrollTo(firstAnchor);
    await page.waitForTimeout(900);
  }
  const start = (Date.now() - t0) / 1000;
  const rest = scene.anchors.slice(1);
  const slot = (duration * 1000) / (rest.length + 1);
  await page.waitForTimeout(slot);
  for (const anchor of rest) {
    await scrollTo(anchor);
    await page.waitForTimeout(slot);
  }
  await context.close();
  const video = join(dir, readdirSync(dir)[0]);

  const srt = join(WORK, `s${i}.srt`);
  writeFileSync(srt, captions(text, speech, LEAD));
  const part = join(WORK, `part${i}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", start.toFixed(2), "-t", duration.toFixed(2), "-i", video,
    "-i", audio,
    "-filter_complex",
    `[0:v]fps=30,scale=${W}:${H},subtitles=${srt}:force_style='FontName=DejaVu Sans,FontSize=10,PrimaryColour=&H00F2F2F2,OutlineColour=&H00000000,BorderStyle=3,Outline=6,BackColour=&H99000000,MarginV=18'[v];` +
      `[1:a]adelay=${Math.round(LEAD * 1000)}:all=1,apad[a]`,
    "-map", "[v]", "-map", "[a]", "-t", duration.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "1",
    part,
  ]);
  parts.push(part);
  console.log(`scene ${i + 1} ${title}: ${duration.toFixed(1)} s`);
}
await browser.close();

writeFileSync(join(WORK, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
const tmp = join(WORK, "demo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(WORK, "list.txt"), "-c", "copy", "-movflags", "+faststart", tmp]);
copyFileSync(tmp, OUT);
console.log(`wrote ${OUT}: ${seconds(OUT).toFixed(1)} s`);
