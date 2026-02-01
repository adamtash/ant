/**
 * Colony Canvas Component
 * Main canvas for ant colony visualization using Konva
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { Stage, Layer, Circle, Line, Group, Text, Rect } from 'react-konva';
import { useColonyStore } from '../../stores/colonyStore';
import { useUIStore } from '../../stores/uiStore';
import type { AntRenderData } from '../entities';
import { colors } from '../../utils/colors';

interface ColonyCanvasProps {
  width: number;
  height: number;
  className?: string;
}

export const ColonyCanvas: React.FC<ColonyCanvasProps> = ({
  width,
  height,
  className = '',
}) => {
  const animationRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);

  const {
    initialize,
    tick,
    start,
    stop,
    isRunning,
    queen,
    chambers,
    trails,
    alarms,
    pheromoneMap,
    getAntRenderData,
    zoom,
    viewportOffset,
    setViewport,
    zoomBy,
    selectedAntId,
    hoveredAntId,
    selectAnt,
    hoverAnt,
  } = useColonyStore();

  const { showPheromoneHeatmap, showChamberLabels, animationsEnabled } = useUIStore();

  // Initialize colony on mount
  useEffect(() => {
    initialize(width, height);
    start();

    return () => {
      stop();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [width, height, initialize, start, stop]);

  // Animation loop
  useEffect(() => {
    if (!animationsEnabled) return;

    const animate = (time: number) => {
      const deltaTime = lastTimeRef.current ? time - lastTimeRef.current : 16;
      lastTimeRef.current = time;

      if (isRunning) {
        tick(deltaTime);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isRunning, tick, animationsEnabled]);

  // Render chambers
  const renderChambers = useCallback(() => {
    const chamberElements: React.ReactNode[] = [];

    chambers.forEach((chamber) => {
      // Chamber background
      chamberElements.push(
        <Circle
          key={`chamber-bg-${chamber.id}`}
          x={chamber.position.x}
          y={chamber.position.y}
          radius={chamber.radius}
          fill={chamber.color}
          opacity={0.15}
        />
      );

      // Chamber border
      chamberElements.push(
        <Circle
          key={`chamber-border-${chamber.id}`}
          x={chamber.position.x}
          y={chamber.position.y}
          radius={chamber.radius}
          stroke={chamber.color}
          strokeWidth={2}
          opacity={0.4}
        />
      );

      // Chamber glow
      chamberElements.push(
        <Circle
          key={`chamber-glow-${chamber.id}`}
          x={chamber.position.x}
          y={chamber.position.y}
          radius={chamber.radius + 10}
          fill={chamber.color}
          opacity={0.05}
        />
      );

      // Chamber label
      if (showChamberLabels) {
        chamberElements.push(
          <Text
            key={`chamber-label-${chamber.id}`}
            x={chamber.position.x - 50}
            y={chamber.position.y + chamber.radius + 10}
            width={100}
            text={chamber.type.charAt(0).toUpperCase() + chamber.type.slice(1)}
            fontSize={12}
            fill={chamber.color}
            align="center"
            opacity={0.7}
          />
        );
      }
    });

    return chamberElements;
  }, [chambers, showChamberLabels]);

  // Render tunnels between chambers
  const renderTunnels = useCallback(() => {
    const tunnelElements: React.ReactNode[] = [];
    const drawnConnections = new Set<string>();

    chambers.forEach((chamber) => {
      chamber.connections.forEach((connectedId) => {
        const connectionKey = [chamber.id, connectedId].sort().join('-');
        if (drawnConnections.has(connectionKey)) return;
        drawnConnections.add(connectionKey);

        const connectedChamber = chambers.get(connectedId);
        if (!connectedChamber) return;

        tunnelElements.push(
          <Line
            key={`tunnel-${connectionKey}`}
            points={[
              chamber.position.x,
              chamber.position.y,
              connectedChamber.position.x,
              connectedChamber.position.y,
            ]}
            stroke={colors.chamber.wall}
            strokeWidth={8}
            lineCap="round"
            opacity={0.3}
          />
        );
      });
    });

    return tunnelElements;
  }, [chambers]);

  // Render pheromone trails with ACO shimmer effect
  const renderTrails = useCallback(() => {
    const trailElements: React.ReactNode[] = [];
    const time = Date.now() * 0.002; // For shimmer animation

    trails.forEach((trail) => {
      const segments = trail.getSegments();
      const avgConcentration = trail.getAverageConcentration();

      segments.forEach((segment, i) => {
        // ACO shimmer effect: stronger trails shimmer more
        const shimmerPhase = time + i * 0.3;
        const shimmerIntensity = Math.sin(shimmerPhase) * 0.2 + 0.8;
        const acoOpacity = segment.opacity * shimmerIntensity;

        // Trail glow (background)
        if (segment.concentration > 0.3) {
          trailElements.push(
            <Line
              key={`trail-glow-${trail.id}-${i}`}
              points={[
                segment.from.x,
                segment.from.y,
                segment.to.x,
                segment.to.y,
              ]}
              stroke={segment.color}
              strokeWidth={segment.width * 3}
              lineCap="round"
              opacity={acoOpacity * 0.2}
            />
          );
        }

        // Main trail
        trailElements.push(
          <Line
            key={`trail-${trail.id}-${i}`}
            points={[
              segment.from.x,
              segment.from.y,
              segment.to.x,
              segment.to.y,
            ]}
            stroke={segment.color}
            strokeWidth={segment.width}
            lineCap="round"
            opacity={acoOpacity}
          />
        );
      });

      // Add path optimization indicator for strong trails
      if (avgConcentration > 0.5 && segments.length > 5) {
        // This is a well-established path (ACO convergence indicator)
        const firstPoint = segments[0]?.from;
        if (firstPoint) {
          trailElements.push(
            <Circle
              key={`trail-start-${trail.id}`}
              x={firstPoint.x}
              y={firstPoint.y}
              radius={4}
              fill={colors.pheromone.trail}
              opacity={avgConcentration * 0.5}
            />
          );
        }
      }
    });

    return trailElements;
  }, [trails]);

  // Render alarm signals
  const renderAlarms = useCallback(() => {
    const alarmElements: React.ReactNode[] = [];

    alarms.forEach((alarm) => {
      const renderData = alarm.getRenderData();

      // Alarm waves
      renderData.waves.forEach((wave) => {
        alarmElements.push(
          <Circle
            key={wave.id}
            x={wave.center.x}
            y={wave.center.y}
            radius={wave.radius}
            stroke={renderData.color}
            strokeWidth={2}
            opacity={wave.intensity * 0.5}
          />
        );
      });

      // Alarm center
      alarmElements.push(
        <Circle
          key={`alarm-center-${alarm.id}`}
          x={renderData.position.x}
          y={renderData.position.y}
          radius={10}
          fill={renderData.color}
          opacity={renderData.intensity}
        />
      );
    });

    return alarmElements;
  }, [alarms]);

  // Render pheromone heatmap
  const renderHeatmap = useCallback(() => {
    if (!showPheromoneHeatmap || !pheromoneMap) return null;

    const heatmapData = pheromoneMap.getHeatmap('trail');

    return heatmapData.map((point, i) => (
      <Circle
        key={`heatmap-${i}`}
        x={point.x}
        y={point.y}
        radius={10}
        fill={colors.pheromone.trail}
        opacity={point.value * 0.5}
      />
    ));
  }, [showPheromoneHeatmap, pheromoneMap]);

  // Render queen
  const renderQueen = useCallback(() => {
    if (!queen) return null;

    const renderData = queen.getQueenRenderData();
    const pulseScale = 1 + Math.sin(renderData.pulsePhase) * 0.05;

    return (
      <Group
        x={renderData.position.x}
        y={renderData.position.y}
        scaleX={pulseScale}
        scaleY={pulseScale}
      >
        {/* Queen aura */}
        <Circle
          radius={60}
          fill={colors.queen.glow}
          opacity={renderData.auraIntensity * 0.3}
        />

        {/* Queen body */}
        <Circle radius={25} fill={colors.queen.amber} />

        {/* Queen crown indicator */}
        <Text
          x={-8}
          y={-35}
          text="👑"
          fontSize={16}
        />

        {/* Activity indicator */}
        {renderData.isActive && (
          <Circle
            radius={30}
            stroke={colors.queen.amber}
            strokeWidth={2}
            opacity={0.5 + Math.sin(renderData.pulsePhase * 2) * 0.3}
          />
        )}
      </Group>
    );
  }, [queen]);

  // Render individual ant
  const renderAnt = useCallback(
    (ant: AntRenderData) => {
      const isSelected = ant.id === selectedAntId;
      const isHovered = ant.id === hoveredAntId;

      const antColor =
        ant.caste === 'soldier'
          ? colors.soldier.rust
          : ant.caste === 'nurse'
          ? colors.nurse.green
          : ant.caste === 'forager'
          ? colors.forager.ochre
          : ant.caste === 'drone'
          ? colors.drone.violet
          : colors.worker.earth;

      const size = 6 * ant.size;

      // Calculate antenna positions with twitch animation
      const antennaLength = size * 0.8;
      const baseAntennaAngle = 0.4; // 23 degrees
      const twitchAmount = Math.sin(ant.antennaPhase * 3) * 0.15;
      const leftAntennaAngle = baseAntennaAngle + twitchAmount;
      const rightAntennaAngle = -baseAntennaAngle - twitchAmount * 0.7;

      // Calculate leg phase for 6-leg animation
      const legOffset = Math.sin(ant.legPhase * 8) * 0.5;

      return (
        <Group
          key={ant.id}
          x={ant.position.x}
          y={ant.position.y}
          rotation={(ant.direction * 180) / Math.PI}
          opacity={ant.opacity * (1 - ant.wear * 0.3)}
          onClick={() => selectAnt(ant.id)}
          onMouseEnter={() => hoverAnt(ant.id)}
          onMouseLeave={() => hoverAnt(null)}
        >
          {/* Selection ring */}
          {isSelected && (
            <Circle
              radius={size + 5}
              stroke={colors.queen.amber}
              strokeWidth={2}
              opacity={0.8}
            />
          )}

          {/* Hover ring */}
          {isHovered && !isSelected && (
            <Circle
              radius={size + 3}
              stroke={colors.ui.textMuted}
              strokeWidth={1}
              opacity={0.5}
            />
          )}

          {/* Legs (3 on each side with alternating movement) */}
          {[-1, 1].map((side) =>
            [0, 1, 2].map((legIndex) => {
              const legAngle = (legIndex - 1) * 0.4 + side * 0.8;
              const legMovement = ((legIndex + (side > 0 ? 0 : 1)) % 2 === 0 ? 1 : -1) * legOffset;
              return (
                <Line
                  key={`leg-${side}-${legIndex}`}
                  points={[
                    0, 0,
                    Math.cos(legAngle + legMovement) * size * 0.8 * side,
                    Math.sin(legAngle + legMovement) * size * 0.6,
                  ]}
                  stroke={antColor}
                  strokeWidth={1}
                  opacity={0.6}
                />
              );
            })
          )}

          {/* Abdomen (back) */}
          <Circle x={-size * 0.6} radius={size * 0.8} fill={antColor} />

          {/* Thorax (middle) */}
          <Circle radius={size * 0.6} fill={antColor} />

          {/* Head */}
          <Circle x={size * 0.7} radius={size * 0.45} fill={antColor} />

          {/* Left antenna */}
          <Line
            points={[
              size * 0.9, 0,
              size * 0.9 + Math.cos(leftAntennaAngle) * antennaLength,
              Math.sin(leftAntennaAngle) * antennaLength,
            ]}
            stroke={antColor}
            strokeWidth={1.5}
            lineCap="round"
          />

          {/* Right antenna */}
          <Line
            points={[
              size * 0.9, 0,
              size * 0.9 + Math.cos(rightAntennaAngle) * antennaLength,
              Math.sin(rightAntennaAngle) * antennaLength,
            ]}
            stroke={antColor}
            strokeWidth={1.5}
            lineCap="round"
          />

          {/* Mandibles for soldiers */}
          {ant.caste === 'soldier' && (
            <>
              <Line
                points={[size * 0.9, size * 0.1, size * 1.2, size * 0.3]}
                stroke={antColor}
                strokeWidth={2}
                lineCap="round"
              />
              <Line
                points={[size * 0.9, -size * 0.1, size * 1.2, -size * 0.3]}
                stroke={antColor}
                strokeWidth={2}
                lineCap="round"
              />
            </>
          )}

          {/* Carrying indicator */}
          {ant.isCarrying && (
            <Circle
              x={-size * 1.2}
              radius={size * 0.4}
              fill={colors.forager.gold}
            />
          )}
        </Group>
      );
    },
    [selectedAntId, hoveredAntId, selectAnt, hoverAnt]
  );

  // Get all ant render data
  const ants = getAntRenderData().filter((a) => a.caste !== 'queen');

  // Tooltip state for hovered ant
  const hoveredAntData = ants.find((a) => a.id === hoveredAntId);

  // Handle mouse wheel for zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const scaleBy = 1.1;
    const newZoom = e.deltaY < 0 ? zoom * scaleBy : zoom / scaleBy;
    // Clamp zoom between 0.3 and 3
    const clampedZoom = Math.min(3, Math.max(0.3, newZoom));
    zoomBy(clampedZoom / zoom, { x: e.clientX, y: e.clientY });
  }, [zoom, zoomBy]);

  return (
    <div className={`relative ${className}`} onWheel={handleWheel}>
      {/* Controls overlay */}
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-2">
        <button
          onClick={() => zoomBy(1.2)}
          className="w-8 h-8 bg-chamber-wall/80 rounded-full text-white hover:bg-chamber-wall flex items-center justify-center"
          title="Zoom In"
        >
          +
        </button>
        <button
          onClick={() => zoomBy(0.8)}
          className="w-8 h-8 bg-chamber-wall/80 rounded-full text-white hover:bg-chamber-wall flex items-center justify-center"
          title="Zoom Out"
        >
          −
        </button>
        <button
          onClick={() => { setViewport({ x: 0, y: 0 }, 1); }}
          className="w-8 h-8 bg-chamber-wall/80 rounded-full text-white hover:bg-chamber-wall flex items-center justify-center text-xs"
          title="Reset View"
        >
          ⟲
        </button>
      </div>

      {/* Ant tooltip */}
      {hoveredAntData && (
        <div
          className="absolute z-20 bg-chamber-dark/95 border border-chamber-wall rounded-lg px-3 py-2 text-xs pointer-events-none"
          style={{
            left: hoveredAntData.position.x * zoom + viewportOffset.x + 20,
            top: hoveredAntData.position.y * zoom + viewportOffset.y - 20,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">
              {hoveredAntData.caste === 'soldier' ? '⚔️' :
               hoveredAntData.caste === 'nurse' ? '💚' :
               hoveredAntData.caste === 'forager' ? '🍂' :
               hoveredAntData.caste === 'drone' ? '🚀' : '🐜'}
            </span>
            <span className="font-medium text-white capitalize">{hoveredAntData.caste}</span>
          </div>
          <div className="text-gray-400">
            State: <span className="text-white">{hoveredAntData.state}</span>
          </div>
          {hoveredAntData.isCarrying && (
            <div className="text-forager-gold">Carrying load</div>
          )}
          <div className="text-gray-500 mt-1">
            Wear: {(hoveredAntData.wear * 100).toFixed(0)}%
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 bg-chamber-dark/80 rounded-lg px-3 py-2 text-xs">
        <div className="text-gray-400 mb-1">Colony Legend</div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-queen-amber"></span>
            <span className="text-gray-300">Queen</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-worker-earth"></span>
            <span className="text-gray-300">Worker</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-soldier-rust"></span>
            <span className="text-gray-300">Soldier</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-nurse-green"></span>
            <span className="text-gray-300">Nurse</span>
          </div>
        </div>
      </div>

      <Stage
        width={width}
        height={height}
        scaleX={zoom}
        scaleY={zoom}
        x={viewportOffset.x}
        y={viewportOffset.y}
        draggable
        onDragEnd={(e) => {
          const stage = e.target.getStage();
          if (stage) {
            setViewport(
              { x: stage.x(), y: stage.y() },
              zoom
            );
          }
        }}
      >
        <Layer>
          {/* Background */}
          <Rect
            width={width / zoom}
            height={height / zoom}
            fill={colors.chamber.dark}
          />

          {/* Tunnels */}
          {renderTunnels()}

          {/* Chambers */}
          {renderChambers()}

          {/* Pheromone heatmap */}
          {renderHeatmap()}

          {/* Pheromone trails */}
          {renderTrails()}

          {/* Alarms */}
          {renderAlarms()}

          {/* Queen */}
          {renderQueen()}

          {/* Workers and other ants */}
          {ants.map(renderAnt)}
        </Layer>
      </Stage>
    </div>
  );
};
