/**
 * Agent Genealogy Tree Component
 * D3.js-powered family tree visualization of agents
 */

import React, { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';

interface AgentNode {
  id: string;
  name: string;
  caste: string;
  status: string;
  parentId?: string;
  children?: AgentNode[];
}

interface AgentGenealogyProps {
  agents: AgentNode[];
  width?: number;
  height?: number;
  onAgentClick?: (agentId: string) => void;
}

// Color palette for castes
const CASTE_COLORS: Record<string, string> = {
  queen: '#F59E0B',
  worker: '#8B7355',
  soldier: '#DC2626',
  nurse: '#84CC16',
  forager: '#EA8A3A',
  architect: '#0EA5E9',
  drone: '#A855F7',
  default: '#6B7280',
};

// Icon emojis for castes
const CASTE_ICONS: Record<string, string> = {
  queen: '👑',
  worker: '🐜',
  soldier: '⚔️',
  nurse: '💚',
  forager: '🍂',
  architect: '🔧',
  drone: '🚀',
};

export const AgentGenealogy: React.FC<AgentGenealogyProps> = ({
  agents,
  width = 600,
  height = 400,
  onAgentClick,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Build hierarchical structure
  const hierarchyData = useMemo(() => {
    if (agents.length === 0) {
      return null;
    }

    // Find root (queen or agent without parent)
    const queen = agents.find((a) => a.caste === 'queen');
    const root = queen || agents.find((a) => !a.parentId) || agents[0];

    // Build tree structure
    const buildTree = (node: AgentNode): AgentNode => {
      const children = agents.filter((a) => a.parentId === node.id);
      return {
        ...node,
        children: children.length > 0 ? children.map(buildTree) : undefined,
      };
    };

    return buildTree(root);
  }, [agents]);

  useEffect(() => {
    if (!svgRef.current || !hierarchyData) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create hierarchy
    const root = d3.hierarchy(hierarchyData);

    // Create tree layout
    const treeLayout = d3
      .tree<AgentNode>()
      .size([width - 100, height - 100]);

    treeLayout(root as any);

    // Create container group with margin
    const g = svg
      .append('g')
      .attr('transform', `translate(50, 50)`);

    // Create tooltip
    const tooltip = d3.select(tooltipRef.current);

    // Draw links
    g.selectAll('.link')
      .data(root.links())
      .join('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', '#374151')
      .attr('stroke-width', 2)
      .attr('d', (d: any) => {
        return `M${d.source.x},${d.source.y}
                C${d.source.x},${(d.source.y + d.target.y) / 2}
                 ${d.target.x},${(d.source.y + d.target.y) / 2}
                 ${d.target.x},${d.target.y}`;
      });

    // Draw nodes
    const nodes = g
      .selectAll('.node')
      .data(root.descendants())
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d: any) => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event: MouseEvent, d: any) {
        d3.select(this).select('circle').attr('r', 25);
        tooltip
          .style('opacity', 1)
          .style('left', `${event.offsetX + 60}px`)
          .style('top', `${event.offsetY + 50}px`)
          .html(`
            <div class="font-medium flex items-center gap-2">
              ${CASTE_ICONS[d.data.caste] || '🐜'} ${d.data.name}
            </div>
            <div class="text-sm text-gray-400">Caste: ${d.data.caste}</div>
            <div class="text-sm text-gray-400">Status: ${d.data.status}</div>
          `);
      })
      .on('mousemove', (event: MouseEvent) => {
        tooltip
          .style('left', `${event.offsetX + 60}px`)
          .style('top', `${event.offsetY + 50}px`);
      })
      .on('mouseleave', function () {
        d3.select(this).select('circle').attr('r', 20);
        tooltip.style('opacity', 0);
      })
      .on('click', (_, d: any) => {
        onAgentClick?.(d.data.id);
      });

    // Add node circles
    nodes
      .append('circle')
      .attr('r', 20)
      .attr('fill', (d: any) => CASTE_COLORS[d.data.caste] || CASTE_COLORS.default)
      .attr('stroke', '#1F2937')
      .attr('stroke-width', 3);

    // Add node icons
    nodes
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', 16)
      .text((d: any) => CASTE_ICONS[d.data.caste] || '🐜')
      .attr('pointer-events', 'none');

    // Add node labels
    nodes
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 35)
      .attr('fill', '#9CA3AF')
      .attr('font-size', 10)
      .text((d: any) => d.data.name)
      .attr('pointer-events', 'none');

    // Add status indicator
    nodes
      .append('circle')
      .attr('cx', 12)
      .attr('cy', -12)
      .attr('r', 5)
      .attr('fill', (d: any) => {
        switch (d.data.status) {
          case 'active':
            return '#10B981';
          case 'thinking':
            return '#F59E0B';
          case 'idle':
            return '#6B7280';
          case 'error':
            return '#EF4444';
          default:
            return '#374151';
        }
      })
      .attr('stroke', '#1F2937')
      .attr('stroke-width', 2);

  }, [hierarchyData, width, height, onAgentClick]);

  if (!hierarchyData || agents.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-gray-500"
      >
        <div className="text-center">
          <span className="text-4xl">🥚</span>
          <p className="mt-2">No agents spawned yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="overflow-visible"
      />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-chamber-dark border border-chamber-wall rounded-lg px-3 py-2 opacity-0 transition-opacity z-10"
      />
    </div>
  );
};
