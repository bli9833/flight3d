import airfield from './incheonAirfield.json' with { type: 'json' };

// Every taxi vertex below is an unchanged node from the frozen mapped taxiways.
// No stand, taxi corridor or runway connector pavement is added by this scenario.
export const DEPARTURE_ROUTE_SOURCES = {
  "apron": "relation/3917465/0",
  "taxiways": [
    "way/316419114",
    "way/507584723",
    "way/469349309",
    "way/13528077",
    "way/507584756",
    "way/316419089",
    "way/968023574"
  ],
  "runway": "way/13528056"
};
const runway = airfield.surfaces.find(surface=>surface.id===DEPARTURE_ROUTE_SOURCES.runway);
const [tx,tz] = runway.points.at(-1), [ex,ez] = runway.points[0];
export const DEPARTURE_RUNWAY = {
  designator: '33L', threshold: {x:tx,z:tz}, end: {x:ex,z:ez},
  headingDeg: (Math.atan2(ex-tx,tz-ez)*180/Math.PI+360)%360,
};

export const DEPARTURE_TAXI_ROUTE = [
  [101.37, -148.16],
  [182.4, -122.34],
  [186.63, -121.37],
  [193.3, -120.57],
  [199.96, -120.86],
  [206.02, -121.83],
  [212.07, -123.59],
  [217.82, -126.08],
  [223.75, -129.42],
  [228.96, -133.44],
  [233.55, -137.94],
  [239.67, -145.79],
  [251.9, -163.59],
  [257.07, -172.7],
  [262.54, -183.05],
  [266.75, -193.81],
  [271.68, -208.72],
  [274.29, -218.04],
  [276.81, -230.05],
  [278.11, -239.61],
  [278.8, -249.18],
  [279.23, -269.75],
  [276.29, -297.28],
  [273.54, -311.05],
  [263.06, -341.42],
  [259.82, -348.57],
  [255.67, -363.58],
  [254.71, -375.26],
  [256.06, -384.84],
  [260.09, -393.58],
  [263.65, -399.01],
  [269.74, -407.07],
  [373.49, -482.56],
  [378.82, -487.77],
  [383.7, -493.62],
  [386.84, -498.56],
  [389.42, -504.14],
  [391.25, -510.75],
  [392.33, -516.44],
  [392.77, -522.92],
  [391.95, -531.28],
  [389.88, -538.67],
  [385.97, -546.8],
  [382.44, -551.59],
  [376.2, -570.4],
  [375.72, -582.93],
  [378.4, -595.64],
  [382.62, -604.41],
  [386.93, -610.51],
  [394.18, -617.59],
  [453.21, -659.59],
  [463.16, -669.01],
].map(([x,z])=>({x,z}));

// Mapped entry nodes followed by an alignment target on the source runway axis.
export const DEPARTURE_LINEUP_ROUTE = [
  [470.27, -678.02],
  [474.75, -685.82],
  [477.67, -693.7],
  [479.89, -700.95],
  [481.36, -708.4],
  [482.05, -727.72],
  [480.52, -735.35],
  [478.16, -743.71],
  [473.18, -754.45],
  [463.91, -769.31],
  [226.3, -1104.66],
].map(([x,z])=>({x,z}));

// Authored gate placement inside source Apron 1; this is not a surveyed stand ID.
export const DEPARTURE_GATE = {x:90.62,z:-201.86,heading:-0.24119528084767608};

// A reverse turning manoeuvre inside Apron 1, not additional pavement geometry.
const radius = 18;
const center = {x:DEPARTURE_GATE.x-radius*Math.cos(DEPARTURE_GATE.heading),
  z:DEPARTURE_GATE.z-radius*Math.sin(DEPARTURE_GATE.heading)};
const dx = DEPARTURE_TAXI_ROUTE[0].x-center.x, dz = DEPARTURE_TAXI_ROUTE[0].z-center.z;
const exitHeading = Math.atan2(dz,dx)+Math.acos(radius/Math.hypot(dx,dz));
const pushTurn = exitHeading-DEPARTURE_GATE.heading;
export const DEPARTURE_PUSHBACK = {radius,turn:pushTurn,exitHeading,center};
export function departurePushbackPose(progress) {
  const heading=DEPARTURE_GATE.heading+pushTurn*Math.max(0,Math.min(1,progress));
  return {x:center.x+radius*Math.cos(heading),z:center.z+radius*Math.sin(heading),heading};
}
