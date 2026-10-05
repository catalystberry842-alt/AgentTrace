// Captures docs/screenshots from the live mainnet app. Waits until skeletons are gone.
//   node scripts/readme-screenshots.mjs [baseUrl]
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://agenttrace-mainnet.vercel.app";
const EXEC = "0x52c98d5058fc9a180a5270aeea72698600f5c6c181d7723a1f503fcdab4c6d5e";
const SHOTS = [
  ["01-landing", "/", false],
  ["02-agent-passport", "/agents/1", true],
  ["03-execution-proof", `/proofs/${EXEC}`, true],
  ["04-firewall", "/firewalls/1", true],
  ["05-mcp-agent-proof", "/proofs/0x8361810c1d8b7f3f932a1b8e005dc0cd9d84980432319f540276fde7216ab798", false],
  ["06-outcome", `/outcomes/${EXEC}`, false],
  ["07-agents", "/agents", false],
];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
for (const [name, path, full] of SHOTS) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector(".skeleton, .animate-pulse"), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: full });
  console.log(name);
}
await browser.close();
