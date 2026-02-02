/**
 * Chamber3D Component
 * Renders a colony chamber as a dug-out cavity
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import type { Chamber } from '../../../stores/colonyStore';

interface Chamber3DProps {
  chamber: Chamber;
}

export const Chamber3D: React.FC<Chamber3DProps> = ({ chamber }) => {
  const { floorMesh, wallMesh, debrisGroup } = useMemo(() => {
    // 1. Floor Geometry (The dug out area)
    const floorGeometry = new THREE.CircleGeometry(chamber.radius, 64);
    
    // Create a noise texture for the floor
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#4e342e'; // Dark earth
        ctx.fillRect(0, 0, 256, 256);
        for(let i=0; i<1000; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#3e2723' : '#5d4037';
            const s = Math.random() * 4;
            ctx.fillRect(Math.random()*256, Math.random()*256, s, s);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);

    const floorMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0x666666, // Darken it
      roughness: 1.0,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: 1, // Draw behind other things
    });

    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.position.set(chamber.position.x, chamber.position.y, -2.1); // Slightly sunken

    // 2. Wall (The rough edge)
    // Use a RingGeometry with many segments to simulate roughness
    const wallGeometry = new THREE.RingGeometry(chamber.radius, chamber.radius + 8, 64, 1);
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x3e2723, // Very dark brown
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.FrontSide,
    });
    
    // Perturb vertices for roughness (simple)
    const posAttribute = wallGeometry.attributes.position;
    for ( let i = 0; i < posAttribute.count; i ++ ) {
        // Only perturb z
        posAttribute.setZ(i, (Math.random() - 0.5) * 2);
    }
    wallGeometry.computeVertexNormals();

    const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
    wallMesh.position.set(chamber.position.x, chamber.position.y, -2.0); // Slightly above floor

    // 3. Debris/Clutter inside
    const debrisGroup = new THREE.Group();
    debrisGroup.position.set(chamber.position.x, chamber.position.y, -2.0);
    const stoneGeom = new THREE.DodecahedronGeometry(1);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 0.8 });
    
    // Add random stones around edges
    const stoneCount = Math.floor(chamber.radius / 3);
    for(let i=0; i<stoneCount; i++) {
        const stone = new THREE.Mesh(stoneGeom, stoneMat);
        const angle = Math.random() * Math.PI * 2;
        const r = chamber.radius * (0.8 + Math.random() * 0.15); // Close to wall
        const s = 1 + Math.random() * 2;
        stone.position.set(Math.cos(angle)*r, Math.sin(angle)*r, 0);
        stone.scale.set(s, s, s*0.5);
        stone.rotation.set(Math.random(), Math.random(), Math.random());
        debrisGroup.add(stone);
    }

    return { floorMesh, wallMesh, debrisGroup };
  }, [chamber.radius, chamber.color, chamber.position.x, chamber.position.y]);

  // Parse color for label
  let hexColor = chamber.color;
  if (hexColor.startsWith('#')) hexColor = hexColor.slice(1);
  const colorValue = parseInt(hexColor, 16);

  return (
    <group>
      {/* @ts-ignore r3f JSX elements */}
      <primitive object={floorMesh} />
      {/* @ts-ignore r3f JSX elements */}
      <primitive object={wallMesh} />
      {/* @ts-ignore r3f JSX elements */}
      <primitive object={debrisGroup} />
      
      {/* Text Label */}
      <Text
        position={[chamber.position.x, chamber.position.y, 10]}
        fontSize={14}
        fontWeight="bold"
        color={new THREE.Color(colorValue).addScalar(0.2).getStyle()} // Lighter tint of chamber theme
        anchorX="center"
        anchorY="middle"
        outlineWidth={1}
        outlineColor="#251610"
        fillOpacity={0.9}
      >
        {chamber.type.toUpperCase()}
      </Text>
    </group>
  );
};
