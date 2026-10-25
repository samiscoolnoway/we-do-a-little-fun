import json, math, sys, glob, os
base = sys.argv[1]
def profile(path):
    meta=None; rows=[]
    for l in open(path):
        if l.startswith('# meta '): meta=json.loads(l[7:])
        elif l and not l.startswith('#') and not l.startswith('i,'):
            p=l.strip().split(',')
            if len(p)==6: rows.append(tuple(map(float,p)))
    return meta, rows
def detectors(meta, rows, N):
    h=1.0/N; xn=meta['xNose']
    def cross(lv):
        for k in range(1,len(rows)):
            a,b=rows[k-1],rows[k]
            if a[4]<lv<=b[4] or (a[4]<lv and b[4]>=lv): return xn-(a[1]+h*(lv-a[4])/(b[4]-a[4]))
    S=0; last=0
    for k,r in enumerate(rows):
        S+=min(max(r[4],0),1); last=k
        if r[4]>=1: break
    ea=xn-(rows[last][1]+0.5*h-h*S)
    return {'mid':cross(0.5),'equalArea':ea}
files={8:'docs/sphere3d-refinement/s3d_rusanov_cutcell_Rh8_off0_downstream0.5_lateral2.csv',12:'docs/sphere3d-refinement/s3d_rusanov_cutcell_Rh12_off0_downstream0.5_lateral2.csv',16:'docs/sphere3d-refinement/s3d_rusanov_cutcell_Rh16_off0_downstream0.5_lateral2.csv',24:'docs/sphere3d-refinement/s3d_rusanov_cutcell_Rh24_off0_downstream0.5_lateral2.csv',32:'docs/sphere3d-refinement/s3d_rusanov_cutcell_Rh32_off0_downstream0.5_lateral2.csv',48:'docs/sphere3d-refinement/s3d_rusanov_cutcell_Rh48_off0_downstream0.5_lateral2.csv',64:'docs/sphere3d-rh64/s3d_rusanov_cutcell_Rh64_off0_downstream0.5_lateral2.csv'}
F={}
for N,f in files.items():
    m,r=profile(os.path.join(base,f)); d=detectors(m,r,N); F[N]=d
    print(f"R/h {N:2d}: from profile mid {d['mid']:.5f} (meta {m['standoff']['mid']:.5f})  EA {d['equalArea']:.5f} (meta {m['standoff']['equalArea']:.5f})")
def celik(Ns, f):  # Ns fine..coarse? use h1<h2<h3
    (N1,N2,N3)=Ns; f1,f2,f3=f
    h1,h2,h3=1/N1,1/N2,1/N3; r21=h2/h1; r32=h3/h2; e21=f2-f1; e32=f3-f2
    if e21*e32<=0: return None
    s=1 if e32/e21>0 else -1
    p=abs(math.log(abs(e32/e21)))/math.log(r21)
    for _ in range(1000):
        q=math.log((r21**p - s)/(r32**p - s))
        pn=abs(math.log(abs(e32/e21))+q)/math.log(r21)
        if abs(pn-p)<1e-13: p=pn; break
        p=pn
    fext=(r21**p*f1-f2)/(r21**p-1)
    gci21=1.25*abs(e21/f1)/(r21**p-1)   # relative
    gci32=1.25*abs(e32/f2)/(r32**p-1)
    return dict(p=p,fext=fext,gci_abs=gci21*f1,asym=gci32/(r21**p*gci21))
print()
for k in ['equalArea','mid']:
    for tri in [(64,48,32),(64,48,24),(64,32,24),(48,32,24),(64,32,16)]:
        c=celik(tri,[F[n][k] for n in tri])
        if not c: print(k,tri,'oscillatory'); continue
        print(f"{k:9s} {tri[2]}/{tri[1]}/{tri[0]}: p {c['p']:.3f} f_ext {c['fext']:.5f} GCI(fine, abs) ±{c['gci_abs']:.5f} asymptotic ratio {c['asym']:.3f}")
print()
# sensitivity of the finest triplets to the single-position values at 48 and 64
for k in ['equalArea','mid']:
    for tri in [(64,48,32),(64,48,24)]:
        c0=celik(tri,[F[n][k] for n in tri])
        for which in [64,48]:
            for d in [+1e-4,-1e-4]:
                v=[F[n][k]+(d if n==which else 0) for n in tri]
                c=celik(tri,v)
                print(f"{k:9s} {tri[2]}/{tri[1]}/{tri[0]}: R/h {which} {d:+.0e} → " + (f"p {c['p']:.3f} (Δ {c['p']-c0['p']:+.3f}) f_ext {c['fext']:.5f} (Δ {c['fext']-c0['fext']:+.5f})" if c else 'oscillatory'))
