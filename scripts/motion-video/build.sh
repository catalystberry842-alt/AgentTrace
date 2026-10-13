#!/usr/bin/env bash
# Rebuilds docs/agenttrace-motion.mp4. Needs ffmpeg, piper-tts (+ en_US-ryan-high voice in ~/piper), numpy, Playwright chromium.
set -euo pipefail; cd "$(dirname "$0")"
node cap3.mjs                                   # fresh 1920x1080 captures + live stats from the mainnet site
mkdir -p vo parts audio
python3 - <<'PY'
import json,subprocess,re,wave
out={}
for k,t in json.load(open('narration.json')):
  segs=[]
  for i,s in enumerate(re.split(r'(?<=[.?!])\s+',t)):
    f=f'vo/{k}_{i}.wav';subprocess.run(['python3','-m','piper','-m',__import__('os').path.expanduser('~/piper/en_US-ryan-high.onnx'),'-f',f],input=s.encode(),check=True,capture_output=True)
    w=wave.open(f);segs.append([s,w.getnframes()/w.getframerate()])
  out[k]=segs
json.dump(out,open('vo/segs.json','w'))
PY
python3 timeline.py
python3 - <<'PY'
import json,datetime,os
tl=json.load(open('timeline.json'));b=json.load(open('cap/boxes.json'))['statsText'].split('\n');g=lambda k:b[b.index(k)+1]
items=[["Agents registered",g("Agents registered")],["Firewalls",g("Firewalls")],["Verified executions",g("Verified executions")],["Proofs anchored",g("Proofs anchored")],["Latest block",g("Latest Monad mainnet block")]]
at=datetime.datetime.fromtimestamp(os.path.getmtime('cap/boxes.json')).strftime('%d %b %Y, %H:%M WAT')
open('data.js','w').write('window.TL='+json.dumps(tl)+';window.STATS='+json.dumps({'items':items,'at':at})+';')
PY
node render.mjs full 6
python3 audio.py
ffmpeg -y -loglevel error -i audio/vo.wav -i audio/sfx.wav -i audio/bed.wav -filter_complex "[0]highpass=f=70,equalizer=f=3500:t=q:w=1:g=2,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,asplit[vo][sc];[1][2]amix=inputs=2:normalize=0[fx];[fx][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[duck];[vo][duck]amix=inputs=2:normalize=0:weights='1 0.9',aformat=channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=9[a]" -map "[a]" -ar 48000 audio/mix.wav
printf "file 'parts/p%d.mp4'\n" 0 1 2 3 4 5 > parts.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i parts.txt -i audio/mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart ../../docs/agenttrace-motion.mp4
