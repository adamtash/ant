/**
 * Tunnel3D Component
 * Renders tunnels connecting chambers as tubes with organic glow
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { Tunnel } from '../../../stores/colonyStore';
import type { Chamber } from '../../../stores/colonyStore';

interface Tunnel3DProps {
  tunnel: Tunnel;
  chambers: Map<string, Chamber>;
}

export const Tunnel3D: React.FC<Tunnel3DProps> = ({ tunnel, chambers }) => {
  const mesh = useMemo(() => {
    const fromChamber = chambers.get(tunnel.from);
    const toChamber = chambers.get(tunnel.to);

    if (!fromChamber || !toChamber) return null;

    // Create a curve connecting the two chamber centers
    const startPoint = new THREE.Vector3(fromChamber.position.x, fromChamber.position.y, -1.5);
    const endPoint = new THREE.Vector3(toChamber.position.x, toChamber.position.y, -1.5);

    // Use a simple linear path for now
    const curve = new THREE.LineCurve3(startPoint, endPoint);

    // Create tube geometry
    // Use tunnel width if available and significant, otherwise fallback to visible size
    const radius = Math.max(tunnel.width, 8); 
    const geometry = new THREE.TubeGeometry(curve, 12, radius, 8, false);

    // Create noise texture
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#4e342e'; 
        ctx.fillRect(0, 0, 64, 64);
        for(let i=0; i<100; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#3e2723' : '#5d4037';
            ctx.fillRect(Math.random()*64, Math.random()*64, 2, 2);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Dark earth material
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0x666666,
      roughness: 1.0,
      metalness: 0.1,
      side: THREE.BackSide, // Render inside of tube
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    // Align tunnel floor with chamber floor (-2.1)
    // Tube center is at -1.5. Bottom is -1.5 - radius.
    // We want bottom to be -2.1.
    // Shift = -2.1 - (-1.5 - radius) = radius - 0.6
    mesh.position.z = radius - 0.6; 
    return mesh;
  }, [tunnel, chambers]);

  if (!mesh) return null;

  // @ts-ignore r3f JSX elements
  return <primitive object={mesh} />;
};
