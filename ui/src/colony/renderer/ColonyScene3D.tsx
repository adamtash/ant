/**
 * Colony Scene 3D Component
 * Main canvas for ant colony visualization using react-three-fiber
 * Provides a "vertical slice" (Ant Farm) view of the colony with 3D graphics
 */

import React, { useEffect, useRef, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useColonyStore } from '../../stores/colonyStore';
import { useUIStore } from '../../stores/uiStore';
import { Ant3D } from './components/Ant3D';
import { Chamber3D } from './components/Chamber3D';
import { Tunnel3D } from './components/Tunnel3D';
import { Pheromone3D } from './components/Pheromone3D';
import { Background3D } from './components/Background3D';

interface ColonyScene3DProps {
  className?: string;
}

/**
 * Scene content component - handles camera setup, lighting, and frame loop
 */
const SceneContent: React.FC = () => {
  const { camera, size } = useThree();
  const lastTimeRef = useRef<number>(0);

  const {
    initialize,
    tick,
    start,
    stop,
    isRunning,
    chambers,
    tunnels,
    trails,
    alarms,
    zoom,
    viewportOffset,
    getAllAnts,
  } = useColonyStore();

  const { animationsEnabled } = useUIStore();

  // Initialize colony on mount
  useEffect(() => {
    initialize(size.width, size.height);
    start();

    return () => {
      stop();
    };
  }, [size.width, size.height, initialize, start, stop]);

  // Setup orthographic camera for XY plane (vertical slice view)
  useEffect(() => {
    const aspect = size.width / size.height;
    const height = 600 / zoom;
    const width = height * aspect;

    // Orthographic camera looking down at XY plane
    (camera as THREE.OrthographicCamera).left = -width / 2;
    (camera as THREE.OrthographicCamera).right = width / 2;
    (camera as THREE.OrthographicCamera).top = height / 2;
    (camera as THREE.OrthographicCamera).bottom = -height / 2;
    (camera as THREE.OrthographicCamera).near = 0.1;
    (camera as THREE.OrthographicCamera).far = 1000;
    (camera as THREE.OrthographicCamera).position.set(
      viewportOffset.x,
      viewportOffset.y,
      100
    );
    (camera as THREE.OrthographicCamera).updateProjectionMatrix();
  }, [camera, size.width, size.height, zoom, viewportOffset]);

  // Main frame loop - updates simulation and renders
  useFrame(() => {
    if (!isRunning || !animationsEnabled) return;

    const now = performance.now();
    const deltaTime = lastTimeRef.current ? now - lastTimeRef.current : 16;
    lastTimeRef.current = now;

    // Advance simulation
    tick(deltaTime);
  });

  return (
    <>
      {/* Lighting */}
      {/* Soft ambient fill */}
      {/* @ts-ignore r3f JSX elements */}
      <ambientLight intensity={0.2} color={0xffffff} />
      
      {/* Mimic underground scattering */}
      {/* @ts-ignore r3f JSX elements */}
      <hemisphereLight args={[0x8d6e63, 0x3e2723, 0.5]} /> 
      
      {/* Main direction light for shadows/bump maps */}
      {/* @ts-ignore r3f JSX elements */}
      <directionalLight 
        position={[50, 100, 100]} 
        intensity={0.8} 
        color={0xffeedd}
        castShadow
      />

      {/* Point light following the camera/viewer for visibility */}
      {/* @ts-ignore r3f JSX elements */}
      <pointLight position={[viewportOffset.x, viewportOffset.y, 50]} intensity={0.3} distance={500} decay={2} />

      {/* Background */}
      <Background3D />

      {/* Chambers */}
      {Array.from(chambers.values()).map((chamber) => (
        <Chamber3D key={`chamber-${chamber.id}`} chamber={chamber} />
      ))}

      {/* Tunnels */}
      {Array.from(tunnels.values()).map((tunnel) => (
        <Tunnel3D key={`tunnel-${tunnel.id}`} tunnel={tunnel} chambers={chambers} />
      ))}

      {/* Pheromones */}
      <Pheromone3D
        trails={Array.from(trails.values())}
        alarms={Array.from(alarms.values())}
      />

      {/* Ants */}
      {getAllAnts().map((ant) => (
        <Ant3D key={`ant-${ant.id}`} ant={ant} />
      ))}

      {/* Controls - restricted to XY plane panning/zooming */}
      <OrbitControls
        enableRotate={false}
        enableZoom={false} // Zoom controlled by store/UI buttons to prevent frustum conflicts
        enablePan={true}
        panSpeed={1}
      />
    </>
  );
};

/**
 * Main 3D Colony Visualization Component
 */
export const ColonyScene3D: React.FC<ColonyScene3DProps> = ({
  className = '',
}) => {
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        orthographic
        dpr={window.devicePixelRatio}
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
};
