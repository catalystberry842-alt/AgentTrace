import soundfile as sf,os,json
from kokoro_onnx import Kokoro
k=Kokoro(os.path.expanduser('~/kokoro/kokoro-v1.0.onnx'),os.path.expanduser('~/kokoro/voices-v1.0.bin'))
L=["An agent acts.","Some calls never get through.","The ones that do leave a trace.","Written on-chain, for anyone to check.","Agent Trace. Live on Monad."]
d=[]
for i,t in enumerate(L):
  s,sr=k.create(t,voice='af_heart',speed=0.92,lang='en-us');sf.write(f'vo/l{i}.wav',s,sr);d.append(len(s)/sr)
json.dump({'lines':L,'dur':d},open('vo/lines.json','w'));print(d)
