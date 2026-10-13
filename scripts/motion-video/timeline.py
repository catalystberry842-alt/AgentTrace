import json
segs=json.load(open('vo/segs.json'))
MIN={'intro':6,'problem':8.5,'blocked':10.5,'pipeline':20,'live':10.5,'verify':10.5,'sdk':9.5,'monad':11,'close':7}
LEAD={'intro':2.4,'close':1.4}
GAP=0.32
DISP=[("Agent Registry","AgentRegistry"),("Agent Firewall","AgentFirewall"),("Agent Proof","AgentProof"),("E R C 8004","ERC-8004"),
("Function Not Allowed","FunctionNotAllowed"),("Trace Call","traceCall"),("fourteen of fourteen","14 of 14"),
("about a hundred seventy-nine thousand gas","about 179,000 gas"),("roughly six hundred milliseconds","roughly 600 ms")]
t=0;scenes=[];cues=[];vo=[]
for k in MIN:
  lead=LEAD.get(k,0.6);c=t+lead
  for i,(s,d) in enumerate(segs[k]):
    txt=s
    for a,b in DISP: txt=txt.replace(a,b)
    cues.append({'s':round(c,3),'e':round(c+d+0.15,3),'text':txt});vo.append({'file':f'vo/{k}_{i}.wav','t':round(c,3)});c+=d+GAP
  dur=max(MIN[k],c-t+1.2);scenes.append({'id':k,'start':round(t,3),'dur':round(dur,3)});t+=dur
json.dump({'total':round(t,3),'scenes':scenes,'cues':cues,'vo':vo},open('timeline.json','w'),indent=1)
for s in scenes:print(s)
print('total',t)
