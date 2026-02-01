/**
 * Card Component
 * Container with ant-themed styling
 */

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'elevated' | 'outlined' | 'glass';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  hoverable?: boolean;
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const variantMap = {
  default: 'bg-chamber-tunnel border border-chamber-wall',
  elevated: 'bg-chamber-tunnel border border-chamber-wall shadow-lg',
  outlined: 'bg-transparent border border-chamber-wall',
  glass: 'bg-chamber-tunnel/50 backdrop-blur-sm border border-chamber-wall/50',
};

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
  onClick,
  hoverable = false,
}) => {
  const baseClasses = 'rounded-lg transition-all duration-200';
  const hoverClasses = hoverable || onClick ? 'hover:border-queen-amber/50 cursor-pointer' : '';
  const variantClasses = variantMap[variant];
  const paddingClasses = paddingMap[padding];

  return (
    <div
      className={`${baseClasses} ${variantClasses} ${paddingClasses} ${hoverClasses} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
};
