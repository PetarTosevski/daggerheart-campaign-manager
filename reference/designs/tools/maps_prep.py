import numpy as np
from PIL import Image
import os
D='/tmp/claude-0/-home-claude/8c15cbbd-62e5-5c85-9f8b-713965359ee3/scratchpad/maps/'
cur=np.asarray(Image.open(D+'cur/30e1f9055a3fb07f7b9757744ff252b7.jpg').convert('RGB')).reshape(-1,3).astype(float)
lum=cur.mean(1); o=np.argsort(lum)
# build tone LUT: map luminance quantiles of new gray map onto color at same quantile of current map
qs=np.linspace(0,1,257)
cur_q=np.array([cur[o[min(len(o)-1,int(q*(len(o)-1)))]] for q in qs])
def margin_crop(g):
    cm=g.mean(0); rm=g.mean(1)
    c=[i for i,v in enumerate(cm) if v<238]; r=[i for i,v in enumerate(rm) if v<238]
    return (c[0]+6,r[0]+6,c[-1]-5,r[-1]-5)
def frame_crop(g, thr=110):
    d=g<thr; H,W=g.shape
    cols=[i for i,v in enumerate(d.mean(0)) if v>0.55]; rows=[i for i,v in enumerate(d.mean(1)) if v>0.55]
    l=max([c for c in cols if c<W*0.06],default=0); r=min([c for c in cols if c>W*0.94],default=W-1)
    t=max([c for c in rows if c<H*0.06],default=0); b=min([c for c in rows if c>H*0.94],default=H-1)
    return (l+4,t+4,r-3,b-3)
INK=cur_q[1]*0.85; PAPER=cur_q[246]
def tone(g):
    lo,hi=np.percentile(g,1),np.percentile(g,97)
    t=(np.clip((g.astype(float)-lo)/(hi-lo),0,1)**1.35)[...,None]
    return Image.fromarray((INK*(1-t)+PAPER*t).astype(np.uint8))
def tone_old(g):
    flat=g.reshape(-1); srt=np.sort(flat)
    # quantile of each pixel value
    ranks=np.searchsorted(srt,np.arange(256),side='right')/len(srt)
    lut=np.array([cur_q[min(256,int(r*256))] for r in ranks])  # 256x3
    return Image.fromarray(lut[g].astype(np.uint8))
def load(f): return np.asarray(Image.open(D+f).convert('L'))
out={}
for key,f in [('fivebanners','core/i-004.png'),('beastfeast','core/i-010.png'),('umbra','core/i-012.png'),('motherboard','core/i-016.png'),('colossus','core/i-020.png'),('castlehigh','hfc/i-000.png'),('weredragon','hfc/i-002.png'),('andaluria','hfc/i-004.png')]:
    g=load(f); box=frame_crop(g) if f.startswith('hfc') else margin_crop(g); g=g[box[1]:box[3],box[0]:box[2]]; out[key]=g; print(key,box,g.shape)
a=load('hfc/i-006.png'); b=load('hfc/i-008.png')
ba=frame_crop(a); bb=frame_crop(b); print('hz',ba,bb)
h=min(ba[3]-ba[1],bb[3]-bb[1])
A=a[ba[1]:ba[1]+h,ba[0]:ba[2]]; B=b[bb[1]:bb[1]+h,bb[0]:bb[2]]
out['horizon']=np.concatenate([A,B],1); print('horizon',out['horizon'].shape)
os.makedirs(D+'final',exist_ok=True)
for k,g in out.items():
    im=tone(g)
    s=min(1,3400/max(im.size)); 
    if s<1: im=im.resize((round(im.width*s),round(im.height*s)),Image.LANCZOS)
    im.save(D+'final/map_'+k+'.jpg',quality=82,optimize=True); print(k,im.size,os.path.getsize(D+'final/map_'+k+'.jpg')//1024,'KB')
    if k=='horizon':
        aw=round(A.shape[1]*s); im.crop((aw-200,600,aw+200,1000)).save(D+'final/seam.png')
