import * as THREE from 'three';
import airfield from '../config/incheonAirfield.json' with { type: 'json' };
import { pointInRing, segmentDistance } from './incheonDressing.js';

export { airfield as INCHEON_AIRFIELD };

/** Airport elevation is a modeled constant, not a surveyed pavement profile. */
export class IncheonFlightSurface {
  constructor(source) {
    this.source = source;
    this.isLoaded = true;
    this.surfaces = airfield.surfaces.map(s => ({ ...s, bounds: [
      Math.min(...s.points.map(p=>p[0])), Math.min(...s.points.map(p=>p[1])),
      Math.max(...s.points.map(p=>p[0])), Math.max(...s.points.map(p=>p[1])),
    ] }));
    // One 25m triangle grid drives both rendered terrain and contact queries.
    this.gridSize = 481;
    this.elevations = new Float32Array(this.gridSize ** 2);
    for (let row=0;row<this.gridSize;row++) for (let col=0;col<this.gridSize;col++) {
      this.elevations[row*this.gridSize+col] = this.gradedHeight(col*25-6000,row*25-6000);
    }
  }

  distance(surface, x, z) {
    if (surface.area && pointInRing(x,z,surface.points)) return 0;
    let distance = Infinity;
    for (let i=1;i<surface.points.length;i++) distance=Math.min(distance,segmentDistance(x,z,surface.points[i-1],surface.points[i]));
    return Math.max(0,distance-(surface.area?0:surface.width/2));
  }

  nearby(surface,x,z,margin) {
    const b=surface.bounds, m=margin+(surface.area?0:surface.width/2);
    return x>=b[0]-m && x<=b[2]+m && z>=b[1]-m && z<=b[3]+m;
  }

  isOnRunway(x,z) {
    return this.surfaces.some(s=>this.nearby(s,x,z,0) && this.distance(s,x,z)<.001);
  }

  isRunwaySafetyArea(x,z) {
    return this.surfaces.some(s=>s.kind==='runway' && this.nearby(s,x,z,60) && this.distance(s,x,z)<=60);
  }

  gradedHeight(x,z) {
    // Outside the finite DSM: sea-level continuation, explicitly not real scenery.
    if (Math.max(Math.abs(x),Math.abs(z))>6000) return 0;
    if (!this.source.isLand(x,z)) return 0;
    let weight=0;
    for (const s of this.surfaces) {
      if (!this.nearby(s,x,z,120)) continue;
      const d=this.distance(s,x,z);
      const u=Math.max(0,Math.min(1,(d-40)/80));
      weight=Math.max(weight,1-u*u*(3-2*u));
      if (weight===1) return airfield.elevationM;
    }
    return this.source.getHeight(x,z)*(1-weight)+airfield.elevationM*weight;
  }

  getHeight(x,z) {
    if (![x,z].every(Number.isFinite)) throw new Error('Invalid flight terrain coordinate');
    if (Math.max(Math.abs(x),Math.abs(z))>6000) return 0;
    if (!this.source.isLand(x,z)) return 0;
    const col=(x+6000)/25,row=(z+6000)/25;
    const ix=Math.min(Math.floor(col),480-1),iz=Math.min(Math.floor(row),480-1);
    const u=col-ix,v=row-iz,i=iz*this.gridSize+ix,g=this.elevations;
    // PlaneGeometry's NW/SW/NE and SW/SE/NE triangles, not bilinear sampling.
    return u+v<=1 ? g[i]*(1-u-v)+g[i+1]*u+g[i+this.gridSize]*v
      : g[i+this.gridSize+1]*(u+v-1)+g[i+1]*(1-v)+g[i+this.gridSize]*(1-u);
  }

  getNormal(x,z) {
    const d=.5;
    return new THREE.Vector3(this.getHeight(x-d,z)-this.getHeight(x+d,z),2*d,
      this.getHeight(x,z-d)-this.getHeight(x,z+d)).normalize();
  }
}

export function incheonSpawn(type, groundClearance, aircraftId='B738') {
  const a=airfield.approach, angle=a.headingDeg*Math.PI/180;
  const direction={x:Math.sin(angle),z:-Math.cos(angle)};
  const distance=type==='approach'?-1500:type==='cruise'?500:100;
  const speed=type==='runway'?0:aircraftId==='C172'?(type==='approach'?33:48):(type==='approach'?74.5:108);
  const y=type==='runway'?airfield.elevationM+groundClearance:type==='approach'
    ?airfield.elevationM+groundClearance+1500*Math.tan(3*Math.PI/180):750;
  return { x:a.threshold.x+direction.x*distance, z:a.threshold.z+direction.z*distance,
    y, yaw:-angle, vx:direction.x*speed, vz:direction.z*speed,
    vy:type==='approach'?-speed*Math.tan(3*Math.PI/180):0 };
}
