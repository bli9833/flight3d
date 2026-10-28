import * as THREE from 'three';
import { DEPARTURE_GATE } from '../config/incheonDeparture.js';

/** Authored G1 passenger bridge aligned to the 737's forward port-side door. */
export function createDepartureJetBridge(groundHeight) {
  const group = new THREE.Group(); group.name = 'departure-jetbridge';
  const anchor = new THREE.Vector3(79.35, groundHeight, -237.66);
  const door = new THREE.Vector3(-2.15, 0, -12.2)
    .applyAxisAngle(new THREE.Vector3(0,1,0), -DEPARTURE_GATE.heading)
    .add(new THREE.Vector3(DEPARTURE_GATE.x,groundHeight,DEPARTURE_GATE.z));
  const distance = Math.hypot(door.x-anchor.x,door.z-anchor.z);
  group.position.copy(anchor);
  group.rotation.y = Math.atan2(door.x-anchor.x,door.z-anchor.z);
  const shell = new THREE.MeshStandardMaterial({color:0xc7d0d7,roughness:.75});
  const frame = new THREE.MeshStandardMaterial({color:0x52616f,roughness:.8});
  const glass = new THREE.MeshStandardMaterial({color:0x39728a,roughness:.25,metalness:.15});
  const rubber = new THREE.MeshStandardMaterial({color:0x222a30,roughness:.95});
  const floorHeight = 3.35, tunnelHeight = 2.6, width = 2.8;
  const box=(parent,w,h,d,x,y,z,material=shell)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const tunnel=(parent,length,tunnelWidth)=>{
    box(parent,tunnelWidth,.18,length,0,floorHeight,length/2,frame);
    box(parent,tunnelWidth,.16,length,0,floorHeight+tunnelHeight,length/2);
    for(const side of [-1,1]) {
      box(parent,.12,.8,length,side*tunnelWidth/2,floorHeight+.5,length/2);
      box(parent,.08,1.35,length,side*tunnelWidth/2,floorHeight+1.55,length/2,glass);
      for(let z=1;z<length;z+=3)box(parent,.16,tunnelHeight,.16,side*tunnelWidth/2,floorHeight+tunnelHeight/2,z,frame);
    }
  };
  const fixedLength=distance*.54, innerStart=fixedLength*.8;
  tunnel(group,fixedLength,width);
  // A fixed-length inner tunnel slides into the outer tunnel when parked.
  const innerLength=distance-innerStart;
  const inner=new THREE.Group();inner.name='jetbridge-telescope';group.add(inner);
  tunnel(inner,innerLength,width-.3);
  const cab=new THREE.Group();cab.name='jetbridge-door-cab';group.add(cab);
  // The rotunda turns independently so the bellows face the port door,
  // rather than pointing along the terminal's telescoping tunnel.
  const intoDoor=new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),-DEPARTURE_GATE.heading);
  cab.rotation.y=Math.atan2(intoDoor.x,intoDoor.z)-group.rotation.y;
  box(cab,3.1,.2,2.1,0,floorHeight,0,frame);
  box(cab,3.1,.18,2.1,0,floorHeight+tunnelHeight,0);
  for(const side of [-1,1])box(cab,.16,tunnelHeight,2.1,side*1.5,floorHeight+tunnelHeight/2,0,glass);
  // Bellows around the door end; the model door itself remains part of the GLB.
  for(const side of [-1,1])box(cab,.26,tunnelHeight,1,side*1.24,floorHeight+tunnelHeight/2,1.05,rubber);
  box(cab,2.7,.22,1,0,floorHeight+tunnelHeight,1.05,rubber);
  const support=new THREE.Group();group.add(support);
  for(const x of [-1,1]) {
    box(support,.25,floorHeight-1,.25,x,(floorHeight-1)/2+.65,0,frame);
    for(const z of [-.4,.4]) {
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,.24,12),rubber);
      wheel.rotation.z=Math.PI/2;wheel.position.set(x,.4,z);support.add(wheel);
    }
  }
  box(group,1.4,floorHeight,1.4,0,floorHeight/2,1,frame);
  let extension=0;
  const bridge={group,cab,door,distance,get extension(){return extension;},setExtension(value){
    extension=THREE.MathUtils.clamp(value,0,1);
    const end=distance-(1-extension)*13;
    inner.position.z=end-innerLength;
    cab.position.x=-Math.sin(cab.rotation.y)*1.05;
    cab.position.z=end-Math.cos(cab.rotation.y)*1.05;
    support.position.z=end-3;
  }};
  bridge.setExtension(0);
  return bridge;
}
