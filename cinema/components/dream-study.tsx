'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Drive } from '@/lib/types';

const FRAGMENT = `
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMood;
uniform float uEnergy;
varying vec2 vUv;
float hash(vec3 p){p=fract(p*.3183099+vec3(.11,.27,.43));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){return noise(p)*.55+noise(p*2.03)*.26+noise(p*4.01)*.13+noise(p*8.03)*.06;}
vec2 scene(vec3 p){
 float t=uTime*.12;
 float orb=length(p-vec3(-.35,.42+sin(t)*.08,-4.3))-(1.15+uEnergy*.08);
 orb+=(fbm(p*4.+t*.1)-.5)*.024;
 float orb2=length(p-vec3(1.35,-.25+sin(t+.8)*.14,-5.1))-.62;
 orb2+=(fbm(p*7.)-.5)*.016;
 float orb3=length(p-vec3(-1.8,-.36+cos(t)*.08,-5.8))-.38;
 float ground=p.y+1.15+(sin(p.x*2.+p.z*.3+t)*.035+fbm(p*2.+vec3(t,0,0))*.12);
 vec2 r=vec2(orb,1.);
 if(orb2<r.x)r=vec2(orb2,2.);
 if(orb3<r.x)r=vec2(orb3,3.);
 if(ground<r.x)r=vec2(ground,4.);
 return r;
}
vec3 normal(vec3 p){vec2 e=vec2(.002,0.);return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,scene(p+e.yxy).x-scene(p-e.yxy).x,scene(p+e.yyx).x-scene(p-e.yyx).x));}
void main(){
 vec2 uv=(vUv-.5)*vec2(uResolution.x/uResolution.y,1.);
 float t=uTime*.1;
 vec3 warm=vec3(.94,.43,.16), cool=vec3(.45,.57,.86);
 vec3 hue=warm;
 if(uMood>1.5&&uMood<2.5)hue=vec3(.57,.33,.72);
 if(uMood>2.5&&uMood<3.5)hue=vec3(.92,.15,.10);
 if(uMood>3.5&&uMood<4.5)hue=vec3(.57,.74,.81);
 if(uMood>4.5)hue=vec3(.62,.73,.24);
 vec3 bg=vec3(.025,.027,.023)+hue*.04;
 float cloud=fbm(vec3(uv*3.,t*.3));
 bg+=hue*pow(max(0.,1.-length((uv-vec2(-.23,.17))*vec2(.8,1.2))),3.)*(.11+cloud*.12);
 vec3 ro=vec3(sin(t*.22)*.16,.12+cos(t*.2)*.08,.35);
 vec3 rd=normalize(vec3(uv*1.9,-2.5));
 float dist=0.;vec2 hit=vec2(100.);bool found=false;
 for(int i=0;i<76;i++){vec3 p=ro+rd*dist;hit=scene(p);if(hit.x<.002){found=true;break;}dist+=hit.x*.8;if(dist>19.)break;}
 vec3 col=bg;
 if(found){
  vec3 p=ro+rd*dist;vec3 n=normal(p);
  vec3 ld=normalize(vec3(-2.,4.,2.)-p);
  float dif=max(0.,dot(n,ld));
  float back=max(0.,dot(n,normalize(vec3(2.,.2,-3.))));
  float spe=pow(max(0.,dot(reflect(-ld,n),-rd)),55.);
  float tex=fbm(p*5.+vec3(t*.15,0.,0.));
  vec3 base=mix(hue*.26,hue*1.4,tex);
  base=mix(base,vec3(.82,.68,.42),max(0.,n.y)*.12);
  if(hit.y<3.5){
    float bands=pow(abs(sin(p.y*28.+noise(p*8.)*8.)),7.);
    base+=hue*bands*.025;
    col=base*(.16+dif*.85)+vec3(1.,.89,.68)*spe*1.3+hue*back*.5;
    col+=hue*pow(max(0.,noise(p*6.+vec3(t*.2))),5.)*.22;
    float rim=pow(1.-max(0.,dot(n,-rd)),3.);col+=hue*rim*.6;
  } else {
    base=vec3(.045,.034,.023);
    float ripple=pow(max(0.,sin(p.z*12.+sin(p.x*4.)+t*2.)),18.);
    float path=exp(-abs(p.x+.3)*2.5);
    col=base+ hue*(spe*.9+ripple*.06+path*.10)*max(0.,1.-dist/20.);
  }
  float fog=1.-exp(-dist*.048);col=mix(col,bg+hue*.04,fog);
 }
 float shafts=pow(max(0.,sin(uv.x*21.+uv.y*4.+cloud*3.+t*.15)),18.);
 col+=hue*shafts*.012;
 if(uMood>4.5){float ribbon=exp(-abs(uv.y-sin(uv.x*3.+t)*.12-.12)*70.);col+=hue*ribbon*.16;}
 if(uMood>3.5&&uMood<4.5){float hair=pow(max(0.,sin(uv.x*82.+sin(uv.y*4.+t)*2.)),55.);col+=hue*hair*.06;}
 if(uMood>2.5&&uMood<3.5){float shadow=smoothstep(-.3,.3,sin(t*.4)+uv.x*.8+uv.y);col*=.36+shadow*.64;}
 // Drifting motes: the image is a procedural visual study, never recorded neural data.
 vec2 grid=vec2(80.,45.);vec2 cell=floor(vUv*grid+vec2(t*.3,t*.12));vec2 local=fract(vUv*grid+vec2(t*.3,t*.12));
 float star=hash(vec3(cell,1.));float mote=smoothstep(.075,0.,length(local-vec2(.5)))*step(.975,star);
 col+=mix(hue,vec3(1.),.6)*mote*.65;
 float grain=(hash(vec3(gl_FragCoord.xy,mod(uTime,100.)))-.5)*.042;
 col+=grain;
 float vignette=1.-dot(uv*vec2(.6,1.),uv*vec2(.6,1.))*.5;col*=max(.2,vignette);
 col=pow(max(col,vec3(0.)),vec3(.82));
 gl_FragColor=vec4(col,1.);
}`;

const MOODS: Record<Drive, number> = { quiet: 0, appetite: 1, aversion: 2, escape: 3, groom: 4, explore: 5 };
export function DreamStudy({ drive, activity, paused = false }: { drive: Drive; activity: number; paused?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ drive, activity, paused });
  useEffect(() => { latest.current = { drive, activity, paused }; }, [drive, activity, paused]);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uResolution: { value: new THREE.Vector2(800, 500) }, uMood: { value: 0 }, uEnergy: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.);}', fragmentShader: FRAGMENT,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));
    const resize = () => { const w = Math.max(1, element.clientWidth), h = Math.max(1, element.clientHeight); renderer.setSize(w, h); material.uniforms.uResolution.value.set(w, h); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    let frame = 0, last = 0, time = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (now - last < 40) return;
      const delta = Math.min(.1, (now - last) / 1000); last = now;
      if (!latest.current.paused && !reduced && !document.hidden) time += delta;
      material.uniforms.uTime.value = time;
      material.uniforms.uMood.value = MOODS[latest.current.drive];
      material.uniforms.uEnergy.value += (latest.current.activity - material.uniforms.uEnergy.value) * .08;
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, []);
  return <div ref={host} className="dream-canvas" aria-label="Procedural cinematic study of a tiny sensory universe" />;
}
