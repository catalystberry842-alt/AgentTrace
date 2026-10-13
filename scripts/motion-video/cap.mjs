import { chromium } from "/workspace/AgentTrace/node_modules/playwright/index.mjs";
import fs from "node:fs";
const B="https://agenttrace-mainnet.vercel.app";
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1920,height:1080},colorScheme:"dark"});
const box=async(l)=>{const r=await l.first().boundingBox();const s=await p.evaluate(()=>scrollY);return r&&{x:Math.round(r.x),y:Math.round(r.y+s),w:Math.round(r.width),h:Math.round(r.height)}};
const out={};
await p.goto(B,{waitUntil:"networkidle"});await p.waitForTimeout(6000);
await p.screenshot({path:"cap/hero.png"});
await p.addStyleTag({content:"header{position:static!important}"});
const st=p.locator('section[aria-label="Live network stats"]');out.statsText=await st.innerText();out.stats=await box(st);
const i=p.getByPlaceholder("0x… execution id or tx hash");
await p.screenshot({path:"cap/landing-pre.png",fullPage:true});
out.verifySecPre=await box(i.locator("xpath=ancestor::section[1]/.."));
await i.fill("0x30985cb60afd8d37b5edfad48312f32ecffa3e34366d31b7f9ec94ef574a9552");
await p.getByRole("button",{name:"Verify",exact:true}).click();
await p.getByText("PASS · proof hash").waitFor({timeout:30000});await p.waitForTimeout(800);
await p.evaluate(()=>scrollTo(0,0));
out.input=await box(i);out.btn=await box(p.getByRole("button",{name:"Verify",exact:true}));
out.pass=await box(p.getByText("PASS · proof hash"));out.rebuilt=await box(p.getByText("Rebuilt hash"));
out.why=await box(p.getByText("Why Monad").locator("xpath=.."));
out.code=await box(p.locator("pre").first());
out.pipeline=await box(p.getByText("How one agent action is checked").locator("xpath=.."));
await p.screenshot({path:"cap/landing-post.png",fullPage:true});






fs.writeFileSync("cap/boxes.json",JSON.stringify(out,null,1));console.log(JSON.stringify(out));
await b.close();
