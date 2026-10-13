# All SFX and the ambient bed are synthesized here from scratch (numpy): original, CC0.
import json,numpy as np,wave,subprocess
SR=48000;TL=json.load(open('timeline.json'));T=TL['total']+0.5
sc={s['id']:s for s in TL['scenes']}
def cues(id):s=sc[id];return [c['s']-s['start'] for c in TL['cues'] if s['start']<=c['s']<s['start']+s['dur']]
rng=np.random.default_rng(7)
def env(n,a,d):t=np.arange(n)/SR;return np.minimum(1,t/max(a,1e-4))*np.exp(-t/d)
def lp(x,k):  # one-pole lowpass
  y=np.zeros_like(x);a=k;acc=0
  for i in range(len(x)):acc+=a*(x[i]-acc);y[i]=acc
  return y
def tick(f=2400,dur=.035,v=.18):n=int(dur*SR);t=np.arange(n)/SR;return v*np.sin(2*np.pi*f*t)*env(n,.0008,.006)+v*.4*rng.normal(size=n)*env(n,.0003,.002)
def click(v=.35):a=tick(1600,.06,v);a[:1920]+=tick(3200,.04,v*.4);return a
def ping(f=880,dur=1.4,v=.16):n=int(dur*SR);t=np.arange(n)/SR;return v*(np.sin(2*np.pi*f*t)+.35*np.sin(2*np.pi*2*f*t)+.12*np.sin(2*np.pi*3.01*f*t))*env(n,.004,.35)
def thud(v=.55):n=int(.7*SR);t=np.arange(n)/SR;f=95*np.exp(-t*3)+45;return v*np.sin(2*np.pi*np.cumsum(f)/SR)*env(n,.003,.18)
def whoosh(dur=.9,v=.12):
  n=int(dur*SR);x=rng.normal(size=n);t=np.arange(n)/SR
  k=.02+.25*np.sin(np.pi*t/dur)**2;y=np.zeros(n);acc=0
  for i in range(n):acc+=k[i]*(x[i]-acc);y[i]=acc
  return v*y*np.sin(np.pi*t/dur)**1.5*3
def chord(fs,dur=3,v=.1):n=int(dur*SR);t=np.arange(n)/SR;return v*sum(np.sin(2*np.pi*f*t) for f in fs)*env(n,.03,1.1)
out=np.zeros(int(T*SR))
def at(t,s):i=int(t*SR);s=s[:len(out)-i];out[i:i+len(s)]+=s
def typing(a,b,step=.055,v=.08):
  t=a
  while t<b:at(t,tick(2200+rng.uniform(-300,300),.03,v*rng.uniform(.7,1)));t+=step*rng.uniform(.8,1.2)
for s in TL['scenes'][1:]:at(s['start']-.35,whoosh(.8,.09))
at(0,whoosh(1.4,.08));at(.9,click(.25));at(1.4,click(.18));at(1.9,ping(660,2,.1));at(2.5,tick(2600,.03,.1))
P=sc['problem']['start'];cu=cues('problem')
for i in range(6):at(P+.9+i*.25,tick(1900,.03,.07))
at(P+cu[1]+1,ping(330,1.2,.08))
B=sc['blocked']['start'];cu=cues('blocked');at(B+.1,click(.15));typing(B+cu[1]+.3,B+cu[1]+1.6);at(B+cu[2]-.1,thud());at(B+cu[2]-.08,tick(700,.08,.15))
for i in range(3):at(B+cu[2]+1.6+i*.3,tick(1800,.035,.09))
PL=sc['pipeline']['start'];cu=cues('pipeline');act=[cu[1],cu[2],cu[3],cu[4],cu[5],cu[5]+2.6]
for i,a in enumerate(act):at(PL+a-.1,ping([523.25,587.33,659.25,783.99,880,1046.5][i],1.4,.09));typing(PL+a+.25,PL+a+1.4,.07,.045)
typing(PL+act[3]+.6,PL+act[3]+2.6,.06,.035)
L=sc['live']['start'];at(L+3.2,whoosh(.6,.07));at(L+7,whoosh(.6,.07));at(L+5.2,click(.2));at(L+8.9,click(.2))
V=sc['verify']['start'];cu=cues('verify');typing(V+cu[1]-.2,V+cu[1]+1.4,.045,.06);ck=cu[1]+2.4;at(V+ck,click(.32))
for i in range(11):at(V+ck+.4+i*.2,tick(2000+i*60,.03,.06))
at(V+cu[2]-.05,chord([523.25,659.25,783.99],2.5,.07))
S=sc['sdk']['start'];cu=cues('sdk');typing(S+.5,S+2.2,.05,.06);at(S+2.3,click(.15));typing(S+cu[1],S+cu[1]+3.2,.07,.035)
M=sc['monad']['start'];cu=cues('monad')
for o in (0,.9,3):at(M+cu[1]+o-.1,ping(740,1,.07));typing(M+cu[1]+o,M+cu[1]+o+1.4,.08,.03)
at(M+cu[2]-.3,whoosh(.6,.06))
CL=sc['close']['start'];at(CL+.1,chord([261.63,392,523.25,659.25],5,.06));at(CL+.1,whoosh(1.2,.07))
# ambient bed: low detuned drone + soft fifth, slow swell
t=np.arange(len(out))/SR
bed=(np.sin(2*np.pi*55*t)+.8*np.sin(2*np.pi*55.3*t)+.45*np.sin(2*np.pi*82.4*t)+.25*np.sin(2*np.pi*110.2*t))*(0.6+0.4*np.sin(2*np.pi*t/14))
bed*=np.minimum(1,t/3)*np.minimum(1,(T-t)/3)*.035
def w(name,x):
  x=np.clip(x,-1,1);ww=wave.open(name,'wb');ww.setnchannels(1);ww.setsampwidth(2);ww.setframerate(SR);ww.writeframes((x*32767).astype('<i2').tobytes());ww.close()
w('audio/sfx.wav',out);w('audio/bed.wav',bed)
# narration track
args=[];flt=[]
for i,v in enumerate(TL['vo']):args+=['-i',v['file']];d=int(v['t']*1000);flt.append(f'[{i}]aresample=48000,adelay={d}|{d}[v{i}]')
n=len(TL['vo']);flt.append(''.join(f'[v{i}]' for i in range(n))+f'amix=inputs={n}:normalize=0,apad=whole_dur={T}[o]')
subprocess.run(['ffmpeg','-y','-loglevel','error',*args,'-filter_complex',';'.join(flt),'-map','[o]','-ac','1','audio/vo.wav'],check=True)
print('ok')
