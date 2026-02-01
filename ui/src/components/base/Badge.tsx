/**
 * Badge Component
 * Status indicators and labels
 */

import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'queen' | 'worker' | 'soldier' | 'nurse' | 'architect' | 'drone';
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

const variantStyles = {
  default: 'bg-chamber-wall text-gray-300',
  queen: 'bg-queen-amber/20 text-queen-amber border border-queen-amber/30',
  worker: 'bg-worker-earth/20 text-worker-brown border border-worker-earth/30',
  soldier: 'bg-soldier-rust/20 text-soldier-alert border border-soldier-rust/30',
  nurse: 'bg-nurse-green/20 text-nurse-sage border border-nurse-green/30',
  architect: 'bg-architect-sky/20 text-architect-light border border-architect-sky/30',
  drone: 'bg-drone-violet/20 text-drone-light border border-drone-violet/30',
};

const dotColors = {
  default: 'bg-gray-400',
  queen: 'bg-queen-amber',
  worker: 'bg-worker-earth',
  soldier: 'bg-soldier-alert',
  nurse: 'bg-nurse-green',
  architect: 'bg-architect-sky',
  drone: 'bg-drone-violet',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  dot = false,
  pulse = false,
  className = '',
}) => {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {dot && (
        <span className="relative mr-1.5">
          <span
            className={`block w-2 h-2 rounded-full ${dotColors[variant]}`}
          />
          {pulse && (
            <span
              className={`absolute inset-0 w-2 h-2 rounded-full ${dotColors[variant]} animate-ping opacity-75`}
            />
          )}
        </span>
      )}
      {children}
    </span>
  );
};
