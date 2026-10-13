import sys,re,urllib.request,urllib.parse,html
q=sys.argv[1];u='https://freesound.org/search/?'+urllib.parse.urlencode({'q':q,'f':'license:"Creative Commons 0"','s':'Downloads descending'})
h=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})).read().decode()
for blk in h.split('class="bw-search__result')[1:]:
  m=re.search(r'data-mp3="([^"]+)"',blk);t=re.search(r'/people/([^/]+)/sounds/(\d+)/"[^>]*title="([^"]+)"',blk) or re.search(r'/people/([^/]+)/sounds/(\d+)/',blk)
  d=re.search(r'data-duration="([\d.]+)"',blk);lic='Creative Commons 0' in blk
  if m and t:print(t.group(2),t.group(1),html.unescape(t.group(3)) if t.lastindex>2 else '',d and d.group(1),lic,m.group(1).replace('-lq','-hq'))
