/**
 * Pheromone3D Component
 * Renders pheromone trails and alarms with shimmer effects
 */

import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Trail, Alarm } from '../../../colony/pheromones';

interface Pheromone3DProps {
  trails: Trail[];
  alarms: Alarm[];
}

export const Pheromone3D: React.FC<Pheromone3DProps> = ({ trails, alarms }) => {
  const groupRef = useRef<THREE.Group>(null);
  const alarmMeshes = useRef<Map<string, THREE.Object3D>>(new Map());
  const trailMeshes = useRef<THREE.Object3D[]>([]);
  const timeRef = useRef<number>(0);

  // Create trail geometries
  useMemo(() => {
    trailMeshes.current = [];

    trails.forEach((trail) => {
      const points = trail.getPoints();
      if (!points || points.length < 2) return;

      // Create line geometry from trail path
      const linePoints = points.map(
        (p) => new THREE.Vector3(p.position.x, p.position.y, -0.5)
      );

      const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);

      // Light blue emissive material with shimmer
      const material = new THREE.LineBasicMaterial({
        color: 0x87ceeb, // Sky blue
        transparent: true,
        opacity: 0.6,
      });

      const line = new THREE.Line(geometry, material);
      trailMeshes.current.push(line);
    });
  }, [trails]);

  // Create alarm geometries
  const createAlarmMesh = (alarm: Alarm): THREE.Mesh => {
    const radius = alarm.intensity * 50; // Scale based on intensity
    const geometry = new THREE.TorusGeometry(
      Math.max(1, radius),
      0.3,
      32,
      100
    );

    // Red emissive material
    const material = new THREE.MeshStandardMaterial({
      color: 0xff6b6b, // Red alert
      emissive: 0xff6b6b,
      emissiveIntensity: 0.9,
      metalness: 0.2,
      roughness: 0.4,
      transparent: true,
      opacity: Math.max(0, alarm.intensity), // Fade based on intensity
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(alarm.position.x, alarm.position.y, -0.3);
    // mesh.rotation.x = Math.PI / 2; // Removed rotation so it lies in XY plane

    return mesh;
  };

  // Update alarm meshes
  useMemo(() => {
    // Remove old alarms
    alarmMeshes.current.forEach((_mesh, id) => {
      const stillExists = alarms.some((a) => a.id === id);
      if (!stillExists) {
        alarmMeshes.current.delete(id);
      }
    });

    // Add new alarms
    alarms.forEach((alarm) => {
      if (!alarmMeshes.current.has(alarm.id)) {
        alarmMeshes.current.set(alarm.id, createAlarmMesh(alarm));
      }
    });
  }, [alarms]);

  // Animate trails and alarms
  useFrame(() => {
    if (!groupRef.current) return;

    timeRef.current += 0.016;

    // Update trail shimmer
    trailMeshes.current.forEach((line) => {
      if (line instanceof THREE.Line && line.material instanceof THREE.LineBasicMaterial) {
        // Pulsing opacity for shimmer effect
        line.material.opacity = 0.4 + Math.sin(timeRef.current * 3) * 0.3;
      }
    });

    // Update alarm meshes
    alarmMeshes.current.forEach((mesh) => {
      if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
        // Pulsing scale for expanding wave effect
        const scale = 1 + Math.sin(timeRef.current * 2) * 0.2;
        mesh.scale.set(scale, scale, scale);
      }
    });
  });

  // @ts-ignore r3f JSX elements
  return (
    // @ts-ignore r3f JSX elements
    <group ref={groupRef}>
      {/* Trails */}
      {trailMeshes.current.map((mesh, i) => (
        // @ts-ignore r3f JSX elements
        <primitive key={`trail-${i}`} object={mesh} />
      ))}

      {/* Alarms */}
      {Array.from(alarmMeshes.current.values()).map((mesh, i) => (
        // @ts-ignore r3f JSX elements
        <primitive key={`alarm-${i}`} object={mesh} />
      ))}
      {/* @ts-ignore r3f JSX elements */}
    </group>
  );
};
