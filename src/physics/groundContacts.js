// Lower surface points, in aircraft body coordinates (+X right, +Y up, -Z forward).
// Engine positions use nacelle bottoms rather than their collision-sphere centers.
export const BODY_CONTACTS = Object.freeze([
  { id: 'engineL', position: [-5.06, -2.95, -5.22] },
  { id: 'engineR', position: [5.06, -2.95, -5.22] },
  { id: 'belly', position: [0, -1.88, 0] },
  { id: 'nose', position: [0, -1.3, -13] },
  { id: 'tail', position: [0, 1.2, 17.5] },
  { id: 'wingL', position: [-17.2, 0.6, 2.8] },
  { id: 'wingR', position: [17.2, 0.6, 2.8] },
]);
