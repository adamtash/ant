/**
 * Ant3D Component
 * Renders a single ant as a 3D model with ref-based imperative updates
 * No React state re-renders - uses useFrame for animation
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Ant } from '../../../colony/entities';
import { colors } from '../../../utils/colors';
import type { AntCaste } from '../../../utils/biology';

interface Ant3DProps {
  ant: Ant;
}

/**
 * Convert hex color string to THREE.Color
 */
function hexToThreeColor(hex: string): THREE.Color {
  if (hex.startsWith('#')) {
    hex = hex.slice(1);
  }
  return new THREE.Color(parseInt(hex, 16));
}

/**
 * Get THREE.Color for ant caste
 */
function getCasteThreeColor(caste: AntCaste): THREE.Color {
  switch (caste) {
    case 'queen':
      return hexToThreeColor(colors.queen.amber);
    case 'worker':
      return hexToThreeColor(colors.worker.brown);
    case 'soldier':
      return hexToThreeColor(colors.soldier.rust);
    case 'nurse':
      return hexToThreeColor(colors.nurse.green);
    case 'architect':
      return hexToThreeColor(colors.architect.blue);
    case 'forager':
      return hexToThreeColor(colors.forager.orange);
    case 'drone':
      return hexToThreeColor(colors.drone.purple);
    default:
      return hexToThreeColor(colors.worker.brown);
  }
}

export const Ant3D: React.FC<Ant3DProps> = ({ ant }) => {
  const groupRef = useRef<THREE.Group>(null);
  const legsRef = useRef<THREE.Group | null>(null);
  const antennaeRef = useRef<THREE.Group | null>(null);
  const timeRef = useRef<number>(0);

  // Global scale for ants to be visible in the chamber view
  const ANT_SCALE = 15.0;

  // Create ant geometry once at mount
  const antGroup = useMemo(() => {
    const group = new THREE.Group();
    group.scale.set(ANT_SCALE, ANT_SCALE, ANT_SCALE); // Scale up immediately
    const casteColor = getCasteThreeColor(ant.caste);

    // HEAD (Triangular/Oval)
    const headGeom = new THREE.SphereGeometry(0.12, 12, 12);
    headGeom.applyMatrix4(new THREE.Matrix4().makeScale(1.0, 0.8, 0.6)); // Flattened
    const mat = new THREE.MeshStandardMaterial({
      color: casteColor,
      roughness: 0.4,
      metalness: 0.3,
    });
    const head = new THREE.Mesh(headGeom, mat);
    head.position.set(0.3, 0, 0.1); 
    group.add(head);

    // EYES (Small black spheres)
    const eyeGeom = new THREE.SphereGeometry(0.04, 8, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1, metalness: 0.8 });
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(0.02, 0.08, 0.05);
    head.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeR.position.set(0.02, -0.08, 0.05);
    head.add(eyeR);


    // THORAX (Elongated capsule-like)
    // We simulate with scaled sphere or cylinder
    const thoraxGeom = new THREE.SphereGeometry(0.14, 12, 12);
    thoraxGeom.applyMatrix4(new THREE.Matrix4().makeScale(1.5, 0.8, 0.8));
    const thorax = new THREE.Mesh(thoraxGeom, mat);
    thorax.position.set(0, 0, 0.1);
    group.add(thorax);

    // PETIOLE (Waist connection)
    const petioleGeom = new THREE.SphereGeometry(0.06, 8, 8);
    const petiole = new THREE.Mesh(petioleGeom, mat);
    petiole.position.set(-0.25, 0, 0.05);
    group.add(petiole);

    // GASTER (Abdomen - Large, Teardrop)
    const gasterGeom = new THREE.SphereGeometry(0.25, 16, 16);
    gasterGeom.applyMatrix4(new THREE.Matrix4().makeScale(1.2, 1.0, 1.0));
    const gaster = new THREE.Mesh(gasterGeom, mat);
    gaster.position.set(-0.6, 0, 0.15); // Behind petiole
    group.add(gaster);


    // Legs - 6 cylinders (3 per side) attached to Thorax
    const legsGroup = new THREE.Group();
    // Femur (Upper leg)
    const femurGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8);
    femurGeom.translate(0, 0.125, 0); // Pivot at end
    
    // Tibia (Lower leg)
    const tibiaGeom = new THREE.CylinderGeometry(0.015, 0.01, 0.3, 8);
    tibiaGeom.translate(0, 0.15, 0);

    const legMat = new THREE.MeshStandardMaterial({
      color: 0x1a0f0a, // Darker legs
      roughness: 0.5,
    });

    // Generate legs positions relative to thorax center
    const legPositions = [
       { x: 0.1, y: -0.1, z: 0, rotZ: -Math.PI/3 }, // Front R
       { x: 0.0, y: -0.1, z: 0, rotZ: -Math.PI/2 }, // Mid R
       { x: -0.1, y: -0.1, z: 0, rotZ: -2*Math.PI/3 }, // Back R
       { x: 0.1, y: 0.1, z: 0, rotZ: Math.PI/3 }, // Front L
       { x: 0.0, y: 0.1, z: 0, rotZ: Math.PI/2 }, // Mid L
       { x: -0.1, y: 0.1, z: 0, rotZ: 2*Math.PI/3 }, // Back L
    ];

    legPositions.forEach((pos, i) => {
      const legContainer = new THREE.Group();
      legContainer.position.set(pos.x, pos.y, 0);
      legContainer.rotation.z = pos.rotZ;
      
      // Upper leg angle up
      const upperLeg = new THREE.Mesh(femurGeom, legMat);
      upperLeg.rotation.x = Math.PI/4; // Angle up from body
      
      // Lower leg angle down
      const lowerLeg = new THREE.Mesh(tibiaGeom, legMat);
      lowerLeg.position.set(0, 0.22, 0.15); // End of upper leg
      lowerLeg.rotation.x = -Math.PI/1.5; // Angle down

      legContainer.add(upperLeg);
      legContainer.add(lowerLeg);

      (legContainer.userData as any).index = i;
      (legContainer.userData as any).side = i < 3 ? 'right' : 'left';
      
      legsGroup.add(legContainer);
    });

    group.add(legsGroup);

    // Antennae - 2 thin bent lines
    const antennaeGroup = new THREE.Group();
    const antPartGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6);
    antPartGeom.translate(0, 0.1, 0);
    
    [-1, 1].forEach((side) => {
        const antenna = new THREE.Group();
        // Base
        const seg1 = new THREE.Mesh(antPartGeom, legMat);
        seg1.rotation.z = side * 0.5;
        seg1.rotation.x = Math.PI/4; // Angle forward
        
        // Tip
        const seg2 = new THREE.Mesh(antPartGeom, legMat);
        seg2.position.set(0, 0.18, 0.05);
        seg2.rotation.z = side * 0.5;
        
        antenna.add(seg1);
        antenna.add(seg2);
        
        antenna.position.set(0.4, side * 0.05, 0.1); 
        antennaeGroup.add(antenna);
    });

    group.add(antennaeGroup);

    return { group, legsGroup, antennaeGroup };
  }, [ant.caste]);

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.add(antGroup.group);
      legsRef.current = antGroup.legsGroup;
      antennaeRef.current = antGroup.antennaeGroup;
    }

    return () => {
      if (groupRef.current && antGroup.group.parent) {
        groupRef.current.remove(antGroup.group);
      }
    };
  }, [antGroup]);

  // Update position and animation every frame
  useFrame(() => {
    if (!groupRef.current) return;

    // Update position
    groupRef.current.position.set(ant.position.x, ant.position.y, 0);

    // Update rotation to face direction of movement
    groupRef.current.rotation.z = ant.direction;

    // Animate legs - walking cycle
    timeRef.current += 0.016; // Approximately 60fps delta

    if (legsRef.current) {
      legsRef.current.children.forEach((leg: THREE.Object3D) => {
        if (leg instanceof THREE.Mesh) {
          const userData = leg.userData as any;
          if (userData.side) {
            const phase = userData.side === 'right' ? 0 : Math.PI;
            const index = userData.index;
            const legPhase = (timeRef.current * 6 + phase + index * (Math.PI / 3)) % (Math.PI * 2);

            // Animate leg position with walking cycle
            const y = -0.1 - index * 0.15;
            const wobble = Math.sin(legPhase) * 0.05;
            leg.position.y = y + wobble;
          }
        }
      });
    }

    // Animate antennae - twitching
    if (antennaeRef.current) {
      antennaeRef.current.children.forEach((antenna: THREE.Object3D, index: number) => {
        const twitch = Math.sin(timeRef.current * 4 + index * Math.PI) * 0.15;
        antenna.rotation.x = Math.PI / 4 + twitch;
      });
    }
  });

  // @ts-ignore r3f JSX elements
  return <group ref={groupRef} />;
};
