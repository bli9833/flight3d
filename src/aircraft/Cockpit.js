import * as THREE from 'three';
import { MCPCanvas } from './MCPCanvas.js';
import { ISFDCanvas } from './ISFDCanvas.js';
import { CDUCanvas } from './CDUCanvas.js';

/**
 * 3D Virtual Cockpit for Boeing Airliner
 * Features fully animated dual control yokes, throttle quadrant, flap handle, spoiler lever,
 * trim wheels, rudder pedals, windshield frame, landing gear lever & lights, flap gauge,
 * dual FMC/CDU screens, standby ISFD, and integrated high-res digital flight displays (PFD, ND, EICAS, MCP).
 */
export class Cockpit {
  constructor(pfdCanvas, ndCanvas, eicasCanvas, mcpCanvas = null, isfdCanvas = null, cduCanvas = null) {
    this.group = new THREE.Group();
    this.pfdCanvas = pfdCanvas;
    this.ndCanvas = ndCanvas;
    this.eicasCanvas = eicasCanvas;
    this.mcpCanvas = mcpCanvas || new MCPCanvas(1024, 128);
    this.isfdCanvas = isfdCanvas || new ISFDCanvas(256, 256);
    this.cduCanvas = cduCanvas || new CDUCanvas(512, 512);

    // Cockpit eye viewpoint (Captain's seat eye position in local aircraft space)
    this.captainEyePos = new THREE.Vector3(-0.48, 0.94, -12.08);

    // Dynamic instruments references
    this.gearLever = null;
    this.gearLights = [];
    this.flapGaugeNeedle = null;

    this.initCockpit();
  }

  initCockpit() {
    // Materials
    const darkInteriorMat = new THREE.MeshStandardMaterial({
      color: 0x181e26,
      roughness: 0.85,
      metalness: 0.15
    });

    const boeingGreyMat = new THREE.MeshStandardMaterial({
      color: 0x3d4852,
      roughness: 0.65,
      metalness: 0.25
    });

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x8a9ba8,
      roughness: 0.35,
      metalness: 0.8
    });

    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x181c20,
      roughness: 0.9,
      metalness: 0.05
    });

    // Glass windshield material
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x88aabb,
      transparent: true,
      opacity: 0.15,
      roughness: 0.05,
      metalness: 0.1,
      transmission: 0.90,
      ior: 1.52,
      reflectivity: 0.5
    });

    // 1. Cockpit Floor
    const floorGeo = new THREE.BoxGeometry(2.4, 0.08, 2.6);
    const floor = new THREE.Mesh(floorGeo, darkInteriorMat);
    floor.position.set(0, 0.04, -12.0);
    this.group.add(floor);

    // 2. Rear Bulkhead Wall & Door (behind pilot at z = -10.8)
    const bulkheadGeo = new THREE.BoxGeometry(2.4, 1.9, 0.08);
    const bulkhead = new THREE.Mesh(bulkheadGeo, darkInteriorMat);
    bulkhead.position.set(0, 0.95, -10.75);
    this.group.add(bulkhead);

    // 3. Glare Shield Hood (Slim sun visor brow sloping from base of windshield forward to MCP)
    const glareGeo = new THREE.BoxGeometry(2.1, 0.025, 0.16);
    const glareShield = new THREE.Mesh(glareGeo, darkInteriorMat);
    glareShield.position.set(0, 0.65, -12.63);
    glareShield.rotation.x = 0.12;
    this.group.add(glareShield);

    // Glareshield front lip / brow
    const browLip = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.035, 0.03), darkInteriorMat);
    browLip.position.set(0, 0.61, -12.55);
    this.group.add(browLip);

    // MCP (Mode Control Panel) mounted on the front face of the glareshield brow
    const mcpBackGeo = new THREE.BoxGeometry(1.74, 0.10, 0.02);
    const mcpBackMesh = new THREE.Mesh(mcpBackGeo, darkInteriorMat);
    mcpBackMesh.position.set(0, 0.545, -12.56);
    mcpBackMesh.rotation.x = -0.15;
    this.group.add(mcpBackMesh);

    const mcpGeo = new THREE.PlaneGeometry(1.72, 0.098);
    const mcpMat = new THREE.MeshBasicMaterial({ map: this.mcpCanvas.texture });
    this.mcpMesh = new THREE.Mesh(mcpGeo, mcpMat);
    this.mcpMesh.position.set(0, 0.545, -12.548);
    this.mcpMesh.rotation.x = -0.15;
    this.group.add(this.mcpMesh);

    // 4. Main Instrument Panel (MIP)
    const mipGeo = new THREE.BoxGeometry(2.1, 0.38, 0.04);
    const mipMesh = new THREE.Mesh(mipGeo, boeingGreyMat);
    mipMesh.position.set(0, 0.30, -12.60);
    mipMesh.rotation.x = -0.10;
    this.group.add(mipMesh);

    // Windshield Pillars & Glass
    this.buildWindshield(glassMat, darkInteriorMat);

    // Flight Displays: Captain PFD, Captain ND, ISFD, Upper EICAS, FO ND, FO PFD, Gear Lever & Flap Dial
    this.buildFlightDisplays(boeingGreyMat, metalMat);

    // Center Console, CDUs & Throttle Pedestal
    this.buildPedestal(boeingGreyMat, metalMat);

    // Dual Boeing Control Yokes (Captain & First Officer)
    this.buildYokes(boeingGreyMat, metalMat);

    // Rudder Pedals
    this.buildRudderPedals(metalMat);

    // Pilot & Copilot Seats
    this.buildSeats(leatherMat, boeingGreyMat);

    // Cockpit Overhead Panel
    this.buildOverheadPanel(boeingGreyMat);

    // MSFS 2024 Authentic Boeing Flight Deck Lighting:
    // 1. Glareshield Underside Amber Integral Floodlight (illuminates main instrument panel with Boeing amber glow)
    this.glareshieldFlood = new THREE.PointLight(0xffa84c, 2.2, 2.4);
    this.glareshieldFlood.position.set(0, 0.58, -12.52);
    this.group.add(this.glareshieldFlood);

    // 2. Center Pedestal Floodlight (amber illumination for FMC/CDU and throttle quadrant)
    this.pedestalFlood = new THREE.PointLight(0xffb55e, 1.4, 2.0);
    this.pedestalFlood.position.set(0, 0.50, -12.05);
    this.group.add(this.pedestalFlood);

    // 3. Cabin Overhead Fill Light
    this.cockpitLight = new THREE.PointLight(0xffeedd, 0.8, 3.5);
    this.cockpitLight.position.set(0, 1.15, -12.1);
    this.group.add(this.cockpitLight);
  }

  buildWindshield(glassMat, frameMat) {
    // Left Front Windshield
    const frontL = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.52), glassMat);
    frontL.position.set(-0.45, 0.95, -12.82);
    frontL.rotation.set(-0.38, 0.20, -0.06);
    this.group.add(frontL);

    // Right Front Windshield
    const frontR = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.52), glassMat);
    frontR.position.set(0.45, 0.95, -12.82);
    frontR.rotation.set(-0.38, -0.20, 0.06);
    this.group.add(frontR);

    // Center Windshield Center Post (Mullion)
    const postCenter = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.65, 0.07), frameMat);
    postCenter.position.set(0, 0.95, -12.82);
    postCenter.rotation.x = -0.38;
    this.group.add(postCenter);

    // Left A-Pillar (angled windshield corner beam)
    const postLeft = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.68, 0.07), frameMat);
    postLeft.position.set(-0.88, 0.96, -12.72);
    postLeft.rotation.set(-0.32, 0.25, -0.20);
    this.group.add(postLeft);

    // Right A-Pillar (angled windshield corner beam)
    const postRight = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.68, 0.07), frameMat);
    postRight.position.set(0.88, 0.96, -12.72);
    postRight.rotation.set(-0.32, -0.25, 0.20);
    this.group.add(postRight);

    // Top Roof Windshield Header Beam
    const roofHeader = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.08, 0.12), frameMat);
    roofHeader.position.set(0, 1.20, -12.68);
    roofHeader.rotation.x = 0.05;
    this.group.add(roofHeader);

    // Lower Windshield Glareshield Sill Beam
    const sillBeam = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.06, 0.08), frameMat);
    sillBeam.position.set(0, 0.68, -12.72);
    this.group.add(sillBeam);

    // Left Side Window
    const sideL = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.48), glassMat);
    sideL.position.set(-0.95, 0.96, -12.5);
    sideL.rotation.set(-0.15, 1.05, 0);
    this.group.add(sideL);

    // Right Side Window
    const sideR = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.48), glassMat);
    sideR.position.set(0.95, 0.96, -12.5);
    sideR.rotation.set(-0.15, -1.05, 0);
    this.group.add(sideR);
  }

  buildFlightDisplays(boeingGreyMat, metalMat) {
    const pfdMat = new THREE.MeshBasicMaterial({ map: this.pfdCanvas.texture });
    const ndMat = new THREE.MeshBasicMaterial({ map: this.ndCanvas.texture });
    const eicasMat = new THREE.MeshBasicMaterial({ map: this.eicasCanvas.texture });
    const isfdMat = new THREE.MeshBasicMaterial({ map: this.isfdCanvas.texture });

    const screenGeo = new THREE.PlaneGeometry(0.20, 0.20);
    const mipRotX = -0.10;
    const dispZ = -12.575;

    // 1. Captain PFD (Outboard left)
    this.pfdScreen = new THREE.Mesh(screenGeo, pfdMat);
    this.pfdScreen.position.set(-0.48, 0.32, dispZ);
    this.pfdScreen.rotation.x = mipRotX;
    this.group.add(this.pfdScreen);

    // 2. Captain ND (Inboard left)
    this.ndScreen = new THREE.Mesh(screenGeo, ndMat);
    this.ndScreen.position.set(-0.24, 0.32, dispZ);
    this.ndScreen.rotation.x = mipRotX;
    this.group.add(this.ndScreen);

    // 3. Standby ISFD (Integrated Standby Flight Display, center-left)
    const isfdGeo = new THREE.PlaneGeometry(0.10, 0.10);
    this.isfdScreen = new THREE.Mesh(isfdGeo, isfdMat);
    this.isfdScreen.position.set(-0.06, 0.36, dispZ);
    this.isfdScreen.rotation.x = mipRotX;
    this.group.add(this.isfdScreen);

    // 4. Center Upper EICAS
    this.eicasScreen = new THREE.Mesh(screenGeo, eicasMat);
    this.eicasScreen.position.set(0.11, 0.32, dispZ);
    this.eicasScreen.rotation.x = mipRotX;
    this.group.add(this.eicasScreen);

    // 5. Landing Gear Lever & 3-Green Annunciators on Center MIP (x = 0.26)
    const gearModuleGroup = new THREE.Group();
    gearModuleGroup.position.set(0.26, 0.37, dispZ + 0.005);
    gearModuleGroup.rotation.x = mipRotX;

    // Gear lever base plate
    const gearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.01), boeingGreyMat);
    gearModuleGroup.add(gearPlate);

    // 3 Gear indicator lights (Nose, Left, Right)
    const lightMatGreen = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const lightMatAmber = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const lightMatOff = new THREE.MeshBasicMaterial({ color: 0x1e293b });
    this.gearLightMats = { green: lightMatGreen, amber: lightMatAmber, off: lightMatOff };

    const noseLight = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), lightMatGreen);
    noseLight.position.set(0, 0.032, 0.006);
    const leftLight = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), lightMatGreen);
    leftLight.position.set(-0.016, 0.018, 0.006);
    const rightLight = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), lightMatGreen);
    rightLight.position.set(0.016, 0.018, 0.006);
    gearModuleGroup.add(noseLight, leftLight, rightLight);
    this.gearLights = [noseLight, leftLight, rightLight];

    // Landing Gear Handle
    this.gearLever = new THREE.Group();
    this.gearLever.position.set(0, -0.012, 0.01);
    const leverRod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 8), metalMat);
    leverRod.position.y = -0.018;
    const leverWheelKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.010, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, transparent: true, opacity: 0.85 })
    );
    leverWheelKnob.rotation.z = Math.PI * 0.5;
    leverWheelKnob.position.y = -0.038;
    this.gearLever.add(leverRod, leverWheelKnob);
    gearModuleGroup.add(this.gearLever);
    this.group.add(gearModuleGroup);

    // 6. Flap Position Indicator Gauge (below gear lever at x = 0.26, y = 0.27)
    const flapGaugeGroup = new THREE.Group();
    flapGaugeGroup.position.set(0.26, 0.27, dispZ + 0.005);
    flapGaugeGroup.rotation.x = mipRotX;

    const flapDial = new THREE.Mesh(
      new THREE.CircleGeometry(0.030, 24),
      new THREE.MeshBasicMaterial({ color: 0x0f172a })
    );
    const flapNeedle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.003, 0.024),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    flapNeedle.position.y = 0.010;
    this.flapGaugeNeedle = new THREE.Group();
    this.flapGaugeNeedle.add(flapNeedle);
    this.flapGaugeNeedle.position.z = 0.002;
    flapGaugeGroup.add(flapDial, this.flapGaugeNeedle);
    this.group.add(flapGaugeGroup);

    // 7. First Officer ND (Inboard right)
    const foNdScreen = new THREE.Mesh(screenGeo, ndMat);
    foNdScreen.position.set(0.42, 0.32, dispZ);
    foNdScreen.rotation.x = mipRotX;
    this.group.add(foNdScreen);

    // 8. First Officer PFD (Outboard right)
    const foPfdScreen = new THREE.Mesh(screenGeo, pfdMat);
    foPfdScreen.position.set(0.66, 0.32, dispZ);
    foPfdScreen.rotation.x = mipRotX;
    this.group.add(foPfdScreen);
  }

  buildPedestal(pedMat, metalMat) {
    this.pedestalGroup = new THREE.Group();
    this.pedestalGroup.position.set(0, 0.16, -12.22);

    // 1. Pedestal Base Structure
    const baseGeo = new THREE.BoxGeometry(0.50, 0.38, 0.95);
    const baseMesh = new THREE.Mesh(baseGeo, pedMat);
    this.pedestalGroup.add(baseMesh);

    // 2. Slanted FMC / CDU Mounting Bay (Transition between MIP and pedestal)
    const cduMountGeo = new THREE.BoxGeometry(0.48, 0.26, 0.04);
    const cduMountMesh = new THREE.Mesh(cduMountGeo, pedMat);
    cduMountMesh.position.set(0, 0.24, -0.32);
    cduMountMesh.rotation.x = -0.65; // Slanted 37 degrees toward pilots
    this.pedestalGroup.add(cduMountMesh);

    // Dual FMC / CDU Screens
    const cduMat = new THREE.MeshBasicMaterial({ map: this.cduCanvas.texture });
    const cduGeo = new THREE.PlaneGeometry(0.20, 0.20);

    // Captain CDU (Left)
    this.cduScreenL = new THREE.Mesh(cduGeo, cduMat);
    this.cduScreenL.position.set(-0.13, 0.26, -0.30);
    this.cduScreenL.rotation.x = -0.65;
    this.pedestalGroup.add(this.cduScreenL);

    // FO CDU (Right)
    this.cduScreenR = new THREE.Mesh(cduGeo, cduMat);
    this.cduScreenR.position.set(0.13, 0.26, -0.30);
    this.cduScreenR.rotation.x = -0.65;
    this.pedestalGroup.add(this.cduScreenR);

    // 3. Throttle Quadrant Housing
    const tqGeo = new THREE.BoxGeometry(0.38, 0.18, 0.40);
    const tqMesh = new THREE.Mesh(tqGeo, new THREE.MeshStandardMaterial({ color: 0x1b2028 }));
    tqMesh.position.set(0, 0.22, 0.02);
    this.pedestalGroup.add(tqMesh);

    // Twin Throttle Levers
    this.throttleLevers = new THREE.Group();
    this.throttleLevers.position.set(0, 0.28, 0.02);

    const leverGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8);
    const knobGeo = new THREE.BoxGeometry(0.045, 0.06, 0.08);

    // Left Engine Throttle
    this.throttle1 = new THREE.Group();
    const lRod = new THREE.Mesh(leverGeo, metalMat);
    lRod.position.y = 0.09;
    const lKnob = new THREE.Mesh(knobGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
    lKnob.position.set(0, 0.18, 0);
    // Reverse piggyback lever
    const lRev = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.03), metalMat);
    lRev.position.set(0, 0.19, -0.045);
    this.throttle1.add(lRod, lKnob, lRev);
    this.throttle1.position.x = -0.045;
    this.throttleLevers.add(this.throttle1);

    // Right Engine Throttle
    this.throttle2 = new THREE.Group();
    const rRod = new THREE.Mesh(leverGeo, metalMat);
    rRod.position.y = 0.09;
    const rKnob = new THREE.Mesh(knobGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
    rKnob.position.set(0, 0.18, 0);
    const rRev = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.03), metalMat);
    rRev.position.set(0, 0.19, -0.045);
    this.throttle2.add(rRod, rKnob, rRev);
    this.throttle2.position.x = 0.045;
    this.throttleLevers.add(this.throttle2);

    this.pedestalGroup.add(this.throttleLevers);

    // Flap Handle (to the right of throttles)
    this.flapLever = new THREE.Group();
    this.flapLever.position.set(0.12, 0.28, 0.08);
    const flapRod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), metalMat);
    flapRod.position.y = 0.07;
    const flapKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.035, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    flapKnob.rotation.z = Math.PI * 0.5;
    flapKnob.position.y = 0.14;
    this.flapLever.add(flapRod, flapKnob);
    this.pedestalGroup.add(this.flapLever);

    // Speedbrake / Spoiler Lever (to the left of throttles)
    this.spoilerLever = new THREE.Group();
    this.spoilerLever.position.set(-0.12, 0.28, 0.04);
    const spRod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), metalMat);
    spRod.position.y = 0.07;
    const spKnob = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0x33b5e5 }));
    spKnob.position.y = 0.14;
    this.spoilerLever.add(spRod, spKnob);
    this.pedestalGroup.add(this.spoilerLever);

    // Prominent Dual Boeing Trim Wheels with White Stripes
    const trimRadius = 0.12;
    const trimThickness = 0.035;
    const trimGroupL = new THREE.Group();
    const trimGroupR = new THREE.Group();

    // Wheel rim
    const rimGeo = new THREE.CylinderGeometry(trimRadius, trimRadius, trimThickness, 24);
    rimGeo.rotateZ(Math.PI * 0.5);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1f242b, roughness: 0.6 });

    const rimL = new THREE.Mesh(rimGeo, wheelMat);
    const rimR = new THREE.Mesh(rimGeo, wheelMat);
    trimGroupL.add(rimL);
    trimGroupR.add(rimR);

    // High-visibility white indicator stripes on trim wheels
    const stripeGeo = new THREE.BoxGeometry(trimThickness + 0.002, 0.015, trimRadius * 2 + 0.004);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stripe1L = new THREE.Mesh(stripeGeo, stripeMat);
    const stripe2L = new THREE.Mesh(stripeGeo, stripeMat);
    stripe2L.rotation.x = Math.PI * 0.5;
    trimGroupL.add(stripe1L, stripe2L);

    const stripe1R = new THREE.Mesh(stripeGeo, stripeMat);
    const stripe2R = new THREE.Mesh(stripeGeo, stripeMat);
    stripe2R.rotation.x = Math.PI * 0.5;
    trimGroupR.add(stripe1R, stripe2R);

    this.trimWheelL = trimGroupL;
    this.trimWheelR = trimGroupR;
    this.trimWheelL.position.set(-0.25, 0.20, 0.02);
    this.trimWheelR.position.set(0.25, 0.20, 0.02);
    this.pedestalGroup.add(this.trimWheelL, this.trimWheelR);

    // 4. Aft Pedestal Radio & Transponder Modules
    const radioGeo = new THREE.BoxGeometry(0.44, 0.04, 0.38);
    const radioMesh = new THREE.Mesh(radioGeo, new THREE.MeshStandardMaterial({ color: 0x161c24 }));
    radioMesh.position.set(0, 0.20, 0.36);
    this.pedestalGroup.add(radioMesh);

    // Illuminated Radio Digital displays (COMM 1 & 2, NAV 1 & 2, XPNDR)
    const radioScreenGeo = new THREE.PlaneGeometry(0.38, 0.12);
    const radioCanvas = document.createElement('canvas');
    radioCanvas.width = 512;
    radioCanvas.height = 160;
    const rctx = radioCanvas.getContext('2d');
    rctx.fillStyle = '#0a0e14';
    rctx.fillRect(0, 0, 512, 160);
    rctx.fillStyle = '#ff9f1c'; // Amber frequency text
    rctx.font = 'bold 20px monospace';
    rctx.fillText('COMM 1: 118.700 [ACTIVE]   121.900 [STBY]', 20, 40);
    rctx.fillText('NAV 1:  109.500 [ILS 09L]  113.800 [VOR]', 20, 80);
    rctx.fillStyle = '#22c55e'; // Green TCAS XPNDR
    rctx.fillText('XPNDR:  2200  TA/RA  ALT RPTG ON', 20, 120);

    const radioTexture = new THREE.CanvasTexture(radioCanvas);
    const radioScreen = new THREE.Mesh(radioScreenGeo, new THREE.MeshBasicMaterial({ map: radioTexture }));
    radioScreen.position.set(0, 0.225, 0.36);
    radioScreen.rotation.x = -Math.PI * 0.5;
    this.pedestalGroup.add(radioScreen);

    // Parking Brake Handle
    const pbGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.08, 12);
    this.parkBrakeHandle = new THREE.Mesh(pbGeo, new THREE.MeshStandardMaterial({ color: 0xdd2222 }));
    this.parkBrakeHandle.position.set(0, 0.24, 0.18);
    this.pedestalGroup.add(this.parkBrakeHandle);

    this.group.add(this.pedestalGroup);
  }

  buildYokes(boeingGreyMat, metalMat) {
    this.captainYoke = this.createBoeingYoke(boeingGreyMat, metalMat);
    this.captainYoke.root.position.set(-0.48, 0.08, -12.35);
    this.group.add(this.captainYoke.root);

    this.foYoke = this.createBoeingYoke(boeingGreyMat, metalMat);
    this.foYoke.root.position.set(0.48, 0.08, -12.35);
    this.group.add(this.foYoke.root);
  }

  createBoeingYoke(yokeMat, metalMat) {
    const root = new THREE.Group();

    // Control Column (Floor mounting tube)
    const columnGeo = new THREE.CylinderGeometry(0.028, 0.035, 0.50, 12);
    const columnMesh = new THREE.Mesh(columnGeo, metalMat);
    columnMesh.position.y = 0.25;
    root.add(columnMesh);

    // Pitch Pivot Group (moves forward & aft with elevator pitch)
    const pitchGroup = new THREE.Group();
    pitchGroup.position.set(0, 0.50, 0);

    // Roll Handlebar Group (rotates with aileron roll)
    const handleGroup = new THREE.Group();

    // Boeing W-shaped handlebar center block
    const centerBlock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.06), yokeMat);
    handleGroup.add(centerBlock);

    // Left and Right Grips
    const gripGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.18, 12);

    const leftGrip = new THREE.Mesh(gripGeo, yokeMat);
    leftGrip.position.set(-0.16, 0.06, 0);
    leftGrip.rotation.z = -0.35;

    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 10), metalMat);
    leftArm.position.set(-0.08, 0.02, 0);
    leftArm.rotation.z = Math.PI * 0.45;

    const rightGrip = new THREE.Mesh(gripGeo, yokeMat);
    rightGrip.position.set(0.16, 0.06, 0);
    rightGrip.rotation.z = 0.35;

    const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 10), metalMat);
    rightArm.position.set(0.08, 0.02, 0);
    rightArm.rotation.z = -Math.PI * 0.45;

    // Pitch trim dual thumb-switches on left horn
    const trimSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    trimSwitch.position.set(-0.17, 0.13, 0.02);

    // Autopilot Disconnect push-button (Red button on left horn)
    const apDiscBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 8), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    apDiscBtn.rotation.x = Math.PI * 0.5;
    apDiscBtn.position.set(-0.14, 0.11, 0.02);

    // Captain's Checklist / Approach Plate Clipboard on center
    const clipGeo = new THREE.BoxGeometry(0.09, 0.11, 0.01);
    const clipMesh = new THREE.Mesh(clipGeo, new THREE.MeshStandardMaterial({ color: 0xdde3ea }));
    clipMesh.position.set(0, 0.02, 0.032);

    handleGroup.add(leftGrip, leftArm, rightGrip, rightArm, trimSwitch, apDiscBtn, clipMesh);
    pitchGroup.add(handleGroup);
    root.add(pitchGroup);

    return {
      root,
      pitchGroup,
      handleGroup
    };
  }

  buildRudderPedals(metalMat) {
    this.pedalsGroup = new THREE.Group();
    this.pedalsGroup.position.set(-0.48, 0.08, -12.72);

    const pedalGeo = new THREE.BoxGeometry(0.10, 0.18, 0.025);
    const pedalMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.4 });

    this.pedalLeft = new THREE.Mesh(pedalGeo, pedalMat);
    this.pedalLeft.position.set(-0.14, 0.08, 0);
    this.pedalLeft.rotation.x = -0.35;

    this.pedalRight = new THREE.Mesh(pedalGeo, pedalMat);
    this.pedalRight.position.set(0.14, 0.08, 0);
    this.pedalRight.rotation.x = -0.35;

    this.pedalsGroup.add(this.pedalLeft, this.pedalRight);
    this.group.add(this.pedalsGroup);
  }

  buildSeats(leatherMat, frameMat) {
    const makeSeat = (x) => {
      const seatGroup = new THREE.Group();
      seatGroup.position.set(x, 0.18, -11.65);

      // Cushion
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.54), leatherMat);
      cushion.position.y = 0.22;

      // Backrest
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.68, 0.14), leatherMat);
      back.position.set(0, 0.62, 0.22);
      back.rotation.x = 0.1;

      // Headrest
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.12), leatherMat);
      head.position.set(0, 1.05, 0.26);

      // Armrests
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.35), frameMat);
      armL.position.set(-0.29, 0.42, 0.05);
      const armR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.35), frameMat);
      armR.position.set(0.29, 0.42, 0.05);

      seatGroup.add(cushion, back, head, armL, armR);
      return seatGroup;
    };

    this.group.add(makeSeat(-0.48)); // Captain
    this.group.add(makeSeat(0.48));  // First Officer
  }

  buildOverheadPanel(boeingGreyMat) {
    const overheadGeo = new THREE.BoxGeometry(1.2, 0.08, 1.1);
    const overhead = new THREE.Mesh(overheadGeo, boeingGreyMat);
    overhead.position.set(0, 1.75, -12.2);
    overhead.rotation.x = 0.2;

    // Overhead illuminated switch panels
    const subGeo = new THREE.PlaneGeometry(1.1, 1.0);
    const oCanvas = document.createElement('canvas');
    oCanvas.width = 512;
    oCanvas.height = 512;
    const octx = oCanvas.getContext('2d');
    octx.fillStyle = '#1e242c';
    octx.fillRect(0, 0, 512, 512);

    // Draw system panel outlines & text (FLT CONTROL, FUEL PUMPS, ELEC, APU, LIGHTS)
    const drawSysBox = (x, y, w, h, title) => {
      octx.strokeStyle = '#384252';
      octx.lineWidth = 2;
      octx.strokeRect(x, y, w, h);
      octx.fillStyle = '#94a3b8';
      octx.font = 'bold 12px sans-serif';
      octx.textAlign = 'center';
      octx.fillText(title, x + w * 0.5, y + 16);
      // Indicator lights
      octx.fillStyle = '#22c55e';
      octx.beginPath();
      octx.arc(x + w * 0.5 - 12, y + 36, 4, 0, Math.PI * 2);
      octx.arc(x + w * 0.5 + 12, y + 36, 4, 0, Math.PI * 2);
      octx.fill();
    };

    drawSysBox(20, 20, 220, 100, 'FLIGHT CONTROLS');
    drawSysBox(260, 20, 230, 100, 'NAVIGATION & DISPLAYS');
    drawSysBox(20, 140, 220, 120, 'FUEL PUMPS & CROSSFEED');
    drawSysBox(260, 140, 230, 120, 'ELECTRICAL (GEN 1 & 2 / APU)');
    drawSysBox(20, 280, 220, 100, 'APU & ENGINE START');
    drawSysBox(260, 280, 230, 100, 'HYDRAULICS (SYS A & B)');
    drawSysBox(20, 400, 470, 90, 'EXTERIOR LIGHTING (LANDING / RUNWAY TURNOFF / STROBE)');

    const oTexture = new THREE.CanvasTexture(oCanvas);
    const oScreen = new THREE.Mesh(subGeo, new THREE.MeshBasicMaterial({ map: oTexture }));
    oScreen.position.y = -0.041;
    oScreen.rotation.x = Math.PI * 0.5;
    overhead.add(oScreen);

    this.group.add(overhead);
  }

  /**
   * Animate cockpit controls dynamically based on physical flight inputs
   */
  updateControls(flightState) {
    // 1. Dual Control Yokes
    const pitchDeflect = (flightState.elevator || 0) * 0.18;
    this.captainYoke.pitchGroup.rotation.x = pitchDeflect;
    this.foYoke.pitchGroup.rotation.x = pitchDeflect;

    const rollDeflect = -(flightState.aileron || 0) * (Math.PI / 3.0);
    this.captainYoke.handleGroup.rotation.z = rollDeflect;
    this.foYoke.handleGroup.rotation.z = rollDeflect;

    // 2. Rudder Pedals
    const rudderDeflect = (flightState.rudder || 0) * 0.05;
    this.pedalLeft.position.z = -rudderDeflect;
    this.pedalRight.position.z = rudderDeflect;

    // 3. Throttle Levers
    const throttleAngle = -0.35 + (flightState.throttle || 0) * 0.70;
    this.throttle1.rotation.x = throttleAngle;
    this.throttle2.rotation.x = throttleAngle;

    // 4. Flap Selector Lever & MIP Flap Dial Needle
    const flapFraction = (flightState.flapIndex || 0) / 6.0;
    this.flapLever.rotation.x = 0.25 - flapFraction * 0.65;
    if (this.flapGaugeNeedle) {
      // Rotate needle from 0 deg (UP) to 220 deg (Flaps 40)
      this.flapGaugeNeedle.rotation.z = -flapFraction * 3.8;
    }

    // 5. Landing Gear Lever & 3-Green Annunciators
    const gearState = flightState.gearState !== undefined ? flightState.gearState : 1.0;
    if (this.gearLever) {
      // Lever tilted down when gear down, tilted up when gear up
      this.gearLever.rotation.x = gearState > 0.5 ? 0.35 : -0.35;
    }
    if (this.gearLights && this.gearLights.length === 3) {
      let targetMat = this.gearLightMats.off;
      if (gearState > 0.95) {
        targetMat = this.gearLightMats.green;
      } else if (gearState > 0.05) {
        targetMat = this.gearLightMats.amber; // Transit amber
      }
      for (const light of this.gearLights) {
        light.material = targetMat;
      }
    }

    // 6. Speedbrake / Spoiler Lever
    const spoilerVal = flightState.spoilers || 0;
    this.spoilerLever.rotation.x = -0.3 + spoilerVal * 0.6;

    // 7. Pitch Trim Wheels
    if (flightState.pitchTrimRate) {
      this.trimWheelL.rotation.x += flightState.pitchTrimRate * 0.1;
      this.trimWheelR.rotation.x += flightState.pitchTrimRate * 0.1;
    }
  }
}
