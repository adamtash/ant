/**
 * Background3D Component
 * Renders the underground backdrop plane with rich soil texture
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';

export const Background3D: React.FC = () => {
  const mesh = useMemo(() => {
    // Create a large plane for the background
    const geometry = new THREE.PlaneGeometry(4000, 4000);

    // Generate procedural soil texture
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // 1. Base Gradient (Darker deeper down)
      const gradient = ctx.createLinearGradient(0, 0, 0, 1024);
      gradient.addColorStop(0, '#5D4037'); // Top soil (lighter)
      gradient.addColorStop(1, '#251610'); // Deep earth (darker)
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1024, 1024);

      // 2. Large Noise (Soil structure)
      for (let i = 0; i < 40000; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const size = Math.random() * 4 + 1;
        const alpha = Math.random() * 0.1;
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Small Noise (Grit/Sand)
      for (let i = 0; i < 100000; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const alpha = Math.random() * 0.15;
        // Mix darker and lighter grains
        ctx.fillStyle = Math.random() > 0.5 
          ? `rgba(255, 255, 255, ${alpha})` 
          : `rgba(0, 0, 0, ${alpha})`;
        ctx.fillRect(x, y, 1, 1);
      }

      // 4. Roots/Veins (Subtle organic lines)
      ctx.strokeStyle = 'rgba(100, 80, 70, 0.2)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 50; i++) {
        ctx.beginPath();
        let startX = Math.random() * 1024;
        let startY = Math.random() * 1024;
        ctx.moveTo(startX, startY);
        for (let j = 0; j < 20; j++) {
          startX += (Math.random() - 0.5) * 50;
          startY += Math.random() * 50;
          ctx.lineTo(startX, startY);
        }
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.MirroredRepeatWrapping;
    texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.repeat.set(4, 4); 

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0x8D6E63, // Tint
      roughness: 1.0,  // Very matte
      metalness: 0.1,
      bumpMap: texture, // Use same texture for bump
      bumpScale: 5.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -10;
    mesh.receiveShadow = true;

    return mesh;
  }, []);

  // @ts-ignore r3f JSX elements
  return <primitive object={mesh} />;
};
