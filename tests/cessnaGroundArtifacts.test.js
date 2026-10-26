import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  GROUND_ARTIFACT_NODES,
  GROUND_ARTIFACT_MATERIALS
} from '../src/aircraft/Cessna172.js';

// Node names, hierarchy and materials live in the glTF JSON chunk, so the shipped
// asset can be audited without a WebGL context or a Draco decode.
function readAsset() {
  const bytes = fs.readFileSync(new URL('../public/models/c172.glb', import.meta.url));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

// Mirror of the visibility rules applied while the loader traverses the model.
function classify(asset) {
  const materialNames = (asset.materials || []).map(m => m.name || '');
  const parentOf = new Map();
  asset.nodes.forEach((node, index) => (node.children || [])
    .forEach(child => parentOf.set(child, index)));
  const sanitized = asset.nodes.map(node =>
    THREE.PropertyBinding.sanitizeNodeName(node.name || ''));

  const hidden = [];
  const visible = [];
  asset.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return;
    let underArtifactNode = false;
    for (let cursor = index; cursor !== undefined; cursor = parentOf.get(cursor)) {
      if (GROUND_ARTIFACT_NODES.has(sanitized[cursor])) {
        underArtifactNode = true;
        break;
      }
    }
    const materials = asset.meshes[node.mesh].primitives
      .map(primitive => materialNames[primitive.material] ?? '');
    const isArtifact = underArtifactNode || materials.some(material =>
      GROUND_ARTIFACT_MATERIALS.some(marker => material.includes(marker)));
    (isArtifact ? hidden : visible).push(node.name || `node_${index}`);
  });
  return { hidden, visible };
}

describe('C172 ground artifact occlusion', () => {
  const asset = readAsset();
  const { hidden, visible } = classify(asset);

  it('names nodes the loader can actually match', () => {
    // PropertyBinding.sanitizeNodeName strips the dots from the authored names, so a
    // dotted literal silently matches nothing. Every artifact must resolve.
    const sceneNames = new Set(asset.nodes.map(node =>
      THREE.PropertyBinding.sanitizeNodeName(node.name || '')));
    assert.equal(GROUND_ARTIFACT_NODES.size, 7);
    for (const name of GROUND_ARTIFACT_NODES) {
      assert.ok(sceneNames.has(name), `${name} is absent from c172.glb`);
    }
  });

  it('hides the complete mooring assembly, not only its straps', () => {
    const index = name => Number(name.match(/\d+$/)[0]);
    assert.deepEqual(hidden.slice().sort((a, b) => index(a) - index(b)), [
      'Object_48', // tie-down cable
      'Object_72', // wing tie-down straps
      'Object_74', // wing tie-down spreader bar
      'Object_76', // nose tie-down strap
      'Object_78', // tie-down strap
      'Object_79', // tie-down cable
      'Object_114', // chock bar
      'Object_116' // concrete pad
    ]);
  });

  it('keeps the airframe rendered', () => {
    for (const part of ['Object_10', 'Object_54', 'Object_4', 'Object_19', 'Object_39', 'Object_37']) {
      assert.ok(visible.includes(part), `${part} must stay visible`);
    }
    // A glTF mesh may be referenced by several nodes, so the auditable population is
    // mesh-bearing nodes rather than the mesh definitions.
    const meshNodes = asset.nodes.filter(node => node.mesh !== undefined).length;
    assert.equal(hidden.length + visible.length, meshNodes);
  });
});
