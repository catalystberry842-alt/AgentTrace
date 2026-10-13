import { chromium } from "/workspace/AgentTrace/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";import fs from "node:fs";
const FPS=30, TL=JSON.parse(fs.readFileSync("timeline.json")), N=Math.ceil(TL.total*FPS);
const mode=process.argv[2];
const b=await chromium.launch();
async function page(){const p=await b.newPage({viewport:{width:1920,height:1080}});await p.goto("file://"+process.cwd()+"/index.html");await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(1500);return p}
if(mode=="stills"){const p=await page();fs.mkdirSync("stills",{recursive:true});for(const t of process.argv.slice(3)){await p.evaluate(t=>render(+t),t);await p.screenshot({path:`stills/t${t}.png`})}}
else{const W=+(process.argv[3]||4);await Promise.all([...Array(W)].map(async(_,w)=>{const a=Math.floor(N*w/W),z=Math.floor(N*(w+1)/W);const p=await page();
 const ff=spawn("ffmpeg",["-y","-loglevel","error","-f","image2pipe","-framerate",""+FPS,"-c:v","png","-i","-","-c:v","libx264","-preset","medium","-crf","14","-pix_fmt","yuv420p",`parts/p${w}.mp4`]);
 for(let f=a;f<z;f++){await p.evaluate(t=>render(t),f/FPS);const buf=await p.screenshot({type:"png"});if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once("drain",r));if(f%150==0)console.log(w,f,z)}
 ff.stdin.end();await new Promise(r=>ff.on("close",r));}));}
await b.close();
