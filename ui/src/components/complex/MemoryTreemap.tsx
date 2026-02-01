/**
 * Memory Treemap Component
 * D3.js-powered treemap visualization of memory categories
 */

import React, { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';

interface TreemapNode {
  name: string;
  value: number;
  category?: string;
}

interface TreemapData {
  name: string;
  children: TreemapNode[];
}

interface MemoryTreemapProps {
  data: Record<string, number>;
  width?: number;
  height?: number;
  onCategoryClick?: (category: string) => void;
}

// Color palette for categories
const CATEGORY_COLORS: Record<string, string> = {
  note: '#84CC16',       // nurse green
  session: '#F59E0B',    // queen amber
  indexed: '#06B6D4',    // fungus cyan
  learned: '#A855F7',    // drone violet
  system: '#0EA5E9',     // architect sky
  default: '#8B7355',    // worker earth
};

export const MemoryTreemap: React.FC<MemoryTreemapProps> = ({
  data,
  width = 400,
  height = 300,
  onCategoryClick,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Transform data for D3 treemap
  const treemapData: TreemapData = useMemo(() => {
    return {
      name: 'Memory',
      children: Object.entries(data).map(([name, value]) => ({
        name,
        value,
        category: name,
      })),
    };
  }, [data]);

  useEffect(() => {
    if (!svgRef.current || !treemapData.children.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create treemap layout
    const root = d3
      .hierarchy(treemapData)
      .sum((d: any) => d.value)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3.treemap<TreemapData>()
      .size([width, height])
      .paddingOuter(4)
      .paddingInner(2)
      .round(true)(root as any);

    // Create tooltip
    const tooltip = d3.select(tooltipRef.current);

    // Create cells
    const cells = svg
      .selectAll('g')
      .data(root.leaves())
      .join('g')
      .attr('transform', (d: any) => `translate(${d.x0},${d.y0})`);

    // Add rectangles
    cells
      .append('rect')
      .attr('width', (d: any) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d: any) => Math.max(0, d.y1 - d.y0))
      .attr('fill', (d: any) => {
        const name = d.data.name.toLowerCase();
        return CATEGORY_COLORS[name] || CATEGORY_COLORS.default;
      })
      .attr('rx', 4)
      .attr('ry', 4)
      .attr('opacity', 0.8)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event: MouseEvent, d: any) {
        d3.select(this).attr('opacity', 1);
        tooltip
          .style('opacity', 1)
          .style('left', `${event.offsetX + 10}px`)
          .style('top', `${event.offsetY - 30}px`)
          .html(`
            <div class="font-medium">${d.data.name}</div>
            <div class="text-sm text-gray-400">${d.value} memories</div>
          `);
      })
      .on('mousemove', (event: MouseEvent) => {
        tooltip
          .style('left', `${event.offsetX + 10}px`)
          .style('top', `${event.offsetY - 30}px`);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('opacity', 0.8);
        tooltip.style('opacity', 0);
      })
      .on('click', (_, d: any) => {
        onCategoryClick?.(d.data.name);
      });

    // Add text labels
    cells
      .append('text')
      .attr('x', 6)
      .attr('y', 18)
      .attr('fill', 'white')
      .attr('font-size', (d: any) => {
        const cellWidth = d.x1 - d.x0;
        return cellWidth > 80 ? 12 : cellWidth > 50 ? 10 : 8;
      })
      .attr('font-weight', 500)
      .text((d: any) => {
        const cellWidth = d.x1 - d.x0;
        const name = d.data.name;
        if (cellWidth < 30) return '';
        if (cellWidth < 60) return name.slice(0, 4);
        return name;
      })
      .attr('pointer-events', 'none');

    // Add value labels
    cells
      .append('text')
      .attr('x', 6)
      .attr('y', 32)
      .attr('fill', 'rgba(255,255,255,0.7)')
      .attr('font-size', 10)
      .text((d: any) => {
        const cellWidth = d.x1 - d.x0;
        if (cellWidth < 40) return '';
        return d.value;
      })
      .attr('pointer-events', 'none');

  }, [treemapData, width, height, onCategoryClick]);

  if (!treemapData.children.length) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-gray-500"
      >
        <div className="text-center">
          <span className="text-4xl">🌱</span>
          <p className="mt-2">No memory data</p>
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
        style={{ transform: 'translateY(-100%)' }}
      />
    </div>
  );
};
