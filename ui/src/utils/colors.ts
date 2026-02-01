/**
 * Ant Colony Color Palette
 * Earth tones + biological accuracy for deep immersion
 */

export const colors = {
  // Castes
  queen: {
    amber: '#F59E0B',
    gold: '#D97706',
    glow: 'rgba(245, 158, 11, 0.3)',
  },
  worker: {
    earth: '#8B7355',
    brown: '#A8896C',
    worn: '#6B5B4F',
  },
  soldier: {
    rust: '#DC2626',
    dark: '#B91C1C',
    alert: '#EF4444',
  },
  nurse: {
    sage: '#84CC16',
    green: '#10B981',
    soft: '#A3E635',
  },
  architect: {
    sky: '#0EA5E9',
    blue: '#3B82F6',
    light: '#38BDF8',
  },
  forager: {
    ochre: '#EA8A3A',
    orange: '#F97316',
    gold: '#FBBF24',
  },
  drone: {
    violet: '#A855F7',
    purple: '#9333EA',
    light: '#C084FC',
  },

  // Pheromones
  pheromone: {
    trail: '#10B981',
    trailGlow: 'rgba(16, 185, 129, 0.4)',
    alarm: '#EF4444',
    alarmGlow: 'rgba(239, 68, 68, 0.5)',
    queen: '#F59E0B',
    queenGlow: 'rgba(245, 158, 11, 0.3)',
    recruitment: '#8B5CF6',
  },

  // Environment
  chamber: {
    dark: '#0B1120',
    darker: '#050810',
    tunnel: '#1E293B',
    wall: '#334155',
  },
  fungus: {
    cyan: '#06B6D4',
    glow: 'rgba(6, 182, 212, 0.3)',
  },

  // Status
  status: {
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
    idle: '#6B7280',
  },

  // UI
  ui: {
    background: '#0F172A',
    surface: '#1E293B',
    border: '#334155',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    textDim: '#64748B',
  },
} as const;

export type ColorKey = keyof typeof colors;
