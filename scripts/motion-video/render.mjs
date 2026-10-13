/* global render -- defined by index.html, evaluated inside the Playwright page */
import { chromium } from "playwright";
import { spawn } from "node:child_process";import fs from "node:fs";
const FPS=+(process.env.FPS||60), T=73, N=Math.round(T*FPS), mode=process.argv[2];
const b=await chromium.launch();
async function page(){const p=await b.newPage({viewport:{width:1920,height:1080}});await p.goto("file://"+process.cwd()+"/index.html");await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(1500);return p}
if(mode=="events"){const p=await page();fs.writeFileSync("events.json",JSON.stringify(await p.evaluate(()=>window.EVENTS),null,1));}
else if(mode=="stills"){const p=await page();fs.mkdirSync("stills",{recursive:true});for(const t of process.argv.slice(3)){await p.evaluate(t=>render(+t),t);await p.screenshot({path:`stills/t${t}.jpg`,type:"jpeg",quality:85})}}
else{const W=+(process.argv[3]||5),out=process.argv[4]||"parts";fs.mkdirSync(out,{recursive:true});await Promise.all([...Array(W)].map(async(_,w)=>{const a=Math.floor(N*w/W),z=Math.floor(N*(w+1)/W);const p=await page();
 const ff=spawn("ffmpeg",["-y","-loglevel","error","-f","image2pipe","-framerate",""+FPS,"-c:v","mjpeg","-i","-","-c:v","libx264","-preset","medium","-crf","16","-pix_fmt","yuv420p",`${out}/p${w}.mp4`]);
 for(let f=a;f<z;f++){await p.evaluate(t=>render(t),f/FPS);const buf=await p.screenshot({type:"jpeg",quality:93});if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once("drain",r));if(f%300==0)console.log(w,f,z)}
 ff.stdin.end();await new Promise(r=>ff.on("close",r));}));}
await b.close();
