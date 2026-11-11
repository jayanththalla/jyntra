#!/usr/bin/env python3
"""Generates Jyntra's original illustration family (shared pedestal, indigo/lime/yellow, soft 3D-ish shapes).
Run: python3 scripts/art/gen-illustrations.py   -> writes public/illustrations/<group>/<name>.svg"""
import os
BASE = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" role="img" aria-label="{label}"><title>{label}</title>
<defs><linearGradient id="i" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a83ff"/><stop offset="1" stop-color="#3f35e0"/></linearGradient>
<linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6ffb0"/><stop offset="1" stop-color="#8fd65f"/></linearGradient>
<linearGradient id="y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffff8a"/><stop offset="1" stop-color="#f0f200"/></linearGradient>
<radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#8a83ff" stop-opacity=".35"/><stop offset="1" stop-color="#8a83ff" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="160" cy="105" rx="130" ry="95" fill="url(#g)"/>
<ellipse cx="160" cy="196" rx="104" ry="14" fill="#2e2a97" opacity=".18"/>
<ellipse cx="160" cy="184" rx="96" ry="20" fill="#d9d6ff"/><ellipse cx="160" cy="178" rx="96" ry="20" fill="#f1f0ff"/>
{body}
<g stroke="#fdff1f" stroke-width="4" stroke-linecap="round" fill="none"><path d="M40 60v12M34 66h12"/><path d="M280 120v10M275 125h10"/></g>
<g fill="#14122b" opacity=".85"><rect x="262" y="40" width="7" height="7"/><rect x="269" y="47" width="7" height="7"/><rect x="276" y="40" width="7" height="7"/></g></svg>'''
Y='stroke="#14122b" stroke-opacity=".18"'
def card(x,y,w,h,fill='url(#i)',rot=0): return f'<g transform="rotate({rot} {x+w/2} {y+h/2})"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" {Y}/><path d="M{x} {y+14}q{w/2} -14 {w} 0v-2a12 12 0 0 0 -12 -12h-{w-24}a12 12 0 0 0 -12 12z" fill="#fff" opacity=".2"/></g>'
def lines(x,y,ws,c='#fff'): return ''.join(f'<rect x="{x}" y="{y+i*11}" width="{w}" height="6" rx="3" fill="{c}" opacity="{.8-i*.15}"/>' for i,w in enumerate(ws))
OBJ={}
OBJ['search']=f'<circle cx="150" cy="96" r="44" fill="#fff" {Y} stroke-width="1"/><circle cx="150" cy="96" r="44" fill="none" stroke="url(#i)" stroke-width="14"/><path d="M184 130l36 36" stroke="#fdff1f" stroke-width="16" stroke-linecap="round"/><path d="M184 130l36 36" stroke="#14122b" stroke-opacity=".15" stroke-width="2" stroke-linecap="round"/><path d="M128 80q10-14 28-12" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".7"/>'
OBJ['documents']=card(98,44,92,118,'#fff',-8)+card(126,38,92,118,'url(#i)',6)+lines(140,66,[56,44,52],'#fff')+f'<rect x="140" y="112" width="40" height="22" rx="8" fill="url(#l)"/>'
OBJ['activity']=f'<rect x="84" y="56" width="152" height="96" rx="16" fill="#fff" {Y}/><path d="M100 116h26l14-34 20 56 18-40 12 18h30" stroke="url(#i)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="214" cy="116" r="7" fill="#fdff1f" {Y}/>'
OBJ['repo']=f'<path d="M120 60v70M120 90q0 30 50 30h30" stroke="#5046f5" stroke-width="8" stroke-linecap="round" fill="none"/><circle cx="120" cy="56" r="16" fill="url(#i)"/><circle cx="120" cy="136" r="16" fill="url(#l)"/><circle cx="206" cy="120" r="16" fill="url(#y)" {Y}/><circle cx="120" cy="56" r="6" fill="#fff"/>'
OBJ['saved']=f'<path d="M120 46h80a8 8 0 0 1 8 8v100l-48-30-48 30V54a8 8 0 0 1 8-8z" fill="url(#i)" {Y}/><path d="M160 74l8 16 18 3-13 12 3 18-16-9-16 9 3-18-13-12 18-3z" fill="#fdff1f"/>'
OBJ['interview']=card(84,50,104,64,'url(#i)',-4)+lines(100,70,[60,44],'#fff')+card(150,92,96,60,'url(#l)',4)+f'<rect x="166" y="112" width="52" height="6" rx="3" fill="#14220f" opacity=".6"/><rect x="166" y="123" width="34" height="6" rx="3" fill="#14220f" opacity=".4"/>'
OBJ['prep']=f'<rect x="108" y="46" width="104" height="116" rx="14" fill="#fff" {Y}/><rect x="124" y="64" width="72" height="8" rx="4" fill="url(#i)"/>'+''.join(f'<circle cx="130" cy="{92+i*22}" r="7" fill="url(#l)"/><rect x="146" y="{89+i*22}" width="{50-i*8}" height="6" rx="3" fill="#a9acc4"/>' for i in range(3))
OBJ['processing']=f'<circle cx="160" cy="98" r="48" fill="none" stroke="#e1defe" stroke-width="14"/><path d="M160 50a48 48 0 0 1 48 48" stroke="url(#i)" stroke-width="14" stroke-linecap="round" fill="none"/><circle cx="160" cy="98" r="20" fill="url(#y)" {Y}/>'
OBJ['report']=f'<rect x="82" y="52" width="156" height="106" rx="16" fill="#fff" {Y}/><rect x="104" y="106" width="22" height="34" rx="5" fill="url(#i)"/><rect x="138" y="88" width="22" height="52" rx="5" fill="url(#l)"/><rect x="172" y="70" width="22" height="70" rx="5" fill="url(#y)" {Y}/><circle cx="222" cy="60" r="20" fill="url(#l)" {Y}/><path d="M213 60l7 7 12-14" stroke="#14220f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
OBJ['atlas']=card(86,60,86,100,'#fff',-8)+card(148,48,86,100,'url(#i)',6)+lines(162,72,[54,40,48],'#fff')+'<path d="M222 40l6 14 14 6-14 6-6 14-6-14-14-6 14-6z" fill="#fdff1f"/>'
OBJ['funding']='<ellipse cx="136" cy="150" rx="42" ry="14" fill="#c9cc00"/><rect x="94" y="128" width="84" height="22" fill="#e8ea00"/><ellipse cx="136" cy="128" rx="42" ry="14" fill="url(#y)"/><ellipse cx="136" cy="104" rx="42" ry="14" fill="#c9cc00"/><rect x="94" y="82" width="84" height="22" fill="#e8ea00"/><ellipse cx="136" cy="82" rx="42" ry="14" fill="url(#y)"/><path d="M196 140l30-40 12 14 20-44" stroke="url(#i)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M246 70h16v16" stroke="#5046f5" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
OBJ['upload']=f'<path d="M96 120h128l-10 36H106z" fill="url(#i)" {Y}/><path d="M160 40v66" stroke="url(#l)" stroke-width="16" stroke-linecap="round"/><path d="M132 66l28-28 28 28" stroke="url(#l)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
OBJ['success']=f'<circle cx="160" cy="98" r="54" fill="url(#l)" {Y}/><circle cx="160" cy="98" r="54" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/><path d="M134 100l20 20 34-40" stroke="#14220f" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
OBJ['error']=f'<path d="M160 44l60 104H100z" fill="url(#y)" stroke="#14122b" stroke-opacity=".3" stroke-width="3" stroke-linejoin="round"/><rect x="154" y="80" width="12" height="38" rx="6" fill="#14122b"/><circle cx="160" cy="130" r="7" fill="#14122b"/>'
OBJ['brand']=f'<rect x="108" y="48" width="104" height="104" rx="28" fill="url(#i)" {Y}/><path d="M108 70q52 -24 104 0v-14a28 28 0 0 0 -28 -28h-48a28 28 0 0 0 -28 28z" fill="#fff" opacity=".16"/><path d="M178 78v44a20 20 0 0 1-20 20 20 20 0 0 1-18-12" stroke="#fdff1f" stroke-width="14" stroke-linecap="round" fill="none"/>'
OBJ['career']=f'<path d="M96 150l40-36 28 20 56-70" stroke="url(#i)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="96" cy="150" r="10" fill="url(#l)"/><circle cx="136" cy="114" r="10" fill="url(#l)"/><circle cx="164" cy="134" r="10" fill="url(#l)"/><circle cx="220" cy="64" r="16" fill="url(#y)" {Y}/>'
GROUPS={'brand':['brand'],'dashboard':['career'],'interview':['interview','prep','processing','report','success'],'atlas':['atlas','upload'],'opensource':['repo','search'],'funding':['funding'],'status':['success','error'],
'empty-states':['activity','search','saved','interview','documents']}
LABEL={'brand':'Jyntra monogram tile','career':'Career path with milestones','interview':'Two speech cards for an interview','prep':'Preparation checklist','processing':'Progress ring while analysing','report':'Report with bars and a check','success':'Success check','error':'Warning triangle','atlas':'Pages with a spark','upload':'Upload arrow into a tray','repo':'Branching repository nodes','search':'Magnifying glass','funding':'Coin stack with rising arrow','activity':'Pulse on a panel','saved':'Bookmark with a star','documents':'Stacked documents'}
n=0
for g,names in GROUPS.items():
    os.makedirs(f'public/illustrations/{g}',exist_ok=True)
    for nm in names:
        open(f'public/illustrations/{g}/{nm}.svg','w').write(BASE.format(label=LABEL[nm],body=OBJ[nm])); n+=1
print(n,'files')
