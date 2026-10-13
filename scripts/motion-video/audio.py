import json,subprocess,numpy as np,random
SR=48000;E=json.load(open('events.json'));T=73.0
KI='snd/kenney_interface-sounds/Audio/';KS='snd/kenney_sci-fi-sounds/Audio/';FS='snd/fs/'
def load(f):
  r=subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True,check=True)
  return np.frombuffer(r.stdout,np.float32).reshape(-1,2).copy()
cache={}
def L(f):
  if f not in cache:cache[f]=load(f)
  return cache[f]
def peak(x):e=np.convolve(np.abs(x).mean(1),np.ones(480)/480,'same');return np.argmax(e)/SR
bus=np.zeros((int(T*SR),2),np.float32);LOG=[]
def put(f,t,db,align_peak=False,name=None):
  x=L(f);t0=t-(peak(x) if align_peak else 0);g=10**(db/20);i=int(round(t0*SR));
  if i<0:x=x[-i:];i=0
  x=x[:len(bus)-i];bus[i:i+len(x)]+=x*g;LOG.append((round(t,2),name or f.split('/')[-1],'peak' if align_peak else 'start'))
rng=random.Random(3)
put(FS+'851556.mp3',E['dot'],-12,name='dot appears')
put(FS+'486234.mp3',E['blkLaunch']+.35,-10,True,'withdraw call launches')
put(FS+'859482.mp3',E['blkHit'],-12,True,'riser into firewall')
put(FS+'737284.mp3',E['blkHit'],-3,True,'LOCK: FunctionNotAllowed')
put(KS+'forceField_000.ogg',E['blkHit'],-16,False,'gate field')
put(FS+'848212.mp3',E['gatePass'],-10,True,'deposit passes firewall')
put(KI+'glass_001.ogg',E['gatePass'],-16,False,'gate lights')
for i,t in enumerate(E['rows']):put(KI+['tick_001.ogg','tick_002.ogg'][i%2],t,-12,False,f'receipt row {i+1}')
put(FS+'859482.mp3',E['hashSettle'],-16,True,'hash riser')
for k in range(14):put(KI+f'click_00{1+k%5}.ogg',E['hashStart']+.15+k*.22+rng.uniform(-.05,.05),-24,False,'hash chars')
put(KI+'confirmation_002.ogg',E['hashSettle'],-14,False,'proofHash settles')
put(FS+'423799.mp3',34.6,-11,True,'hash collapses into trace')
for i,t in enumerate(E['blocks']):put(KI+'tick_004.ogg',t,-19,False,f'block tile {163+i}')
put(FS+'859482.mp3',E['anchor'],-10,True,'riser into anchor')
put(FS+'856174.mp3',E['anchor'],-7,True,'SUB HIT: anchorProof')
put(FS+'486234.mp3',43.0,-13,True,'rise to ERC-8004')
put(KI+'select_002.ogg',E['w1'],-12,False,'validationResponse written')
put(KI+'select_004.ogg',E['w2'],-12,False,'giveFeedback written')
put(FS+'848212.mp3',56.0,-11,True,'pull back reveal')
put(FS+'486234.mp3',60.6,-11,True,'push into live site')
t=E['typeStart']
while t<E['typeEnd']:put(KI+f'click_00{rng.randint(1,5)}.ogg',t,-23,False,'id typing');t+=.075
put(FS+'528561.mp3',E['click'],-6,False,'Verify click')
put(KI+'confirmation_001.ogg',E['pass'],-10,False,'PASS')
for k in range(11):put(KI+'tick_001.ogg',E['click']+.3+k*.14,-24,False,'checks reveal')
put(FS+'423799.mp3',66.3,-14,True,'dissolve')
put(FS+'856174.mp3',E['logoDraw']+.2,-15,True,'logo forms')
put(KI+'maximize_006.ogg',E['logoDraw']+.3,-16,False,'logo stroke')
put(KI+'glass_002.ogg',E['logoDot'],-15,False,'dot becomes logo')
def w(name,x):subprocess.run(['ffmpeg','-y','-v','error','-f','f32le','-ar',str(SR),'-ac','2','-i','-',name],input=x.astype(np.float32).tobytes(),check=True)
w('audio/sfx.wav',bus)
# VO
VO=[1.6,9.7,29.6,46.6,67.8];vo=np.zeros_like(bus)
for i,t in enumerate(VO):x=L(f'vo/l{i}.wav');i0=int(t*SR);vo[i0:i0+len(x)]+=x
w('audio/vo.wav',vo)
# music: CC0, trimmed, fades
m=L(FS+'495747.mp3')[:int(T*SR)];tt=np.arange(len(m))/SR;m=m*np.minimum(1,tt/2.5)[:,None]*np.clip((72.6-tt)/2.6,0,1)[:,None]
mm=np.zeros_like(bus);mm[:len(m)]=m;w('audio/music.wav',mm)
json.dump({'vo':VO,'sfx':LOG},open('audio/cues.json','w'),indent=0)
print(len(LOG),'sfx placed')
