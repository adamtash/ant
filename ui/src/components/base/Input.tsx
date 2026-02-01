/**
 * Input Component
 * Ant-themed text input
 */

import React from 'react';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-5 py-3 text-lg',
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      size = 'md',
      icon,
      iconPosition = 'left',
      className = '',
      ...props
    },
    ref
  ) => {
    const baseClasses =
      'w-full bg-chamber-dark border rounded-lg text-white placeholder-gray-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-queen-amber/50 focus:border-queen-amber';

    const errorClasses = error
      ? 'border-soldier-rust focus:ring-soldier-rust/50 focus:border-soldier-rust'
      : 'border-chamber-wall';

    const iconClasses = icon
      ? iconPosition === 'left'
        ? 'pl-10'
        : 'pr-10'
      : '';

    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && iconPosition === 'left' && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`${baseClasses} ${errorClasses} ${sizeStyles[size]} ${iconClasses} ${className}`}
            {...props}
          />
          {icon && iconPosition === 'right' && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {icon}
            </div>
          )}
        </div>
        {error && <p className="mt-1 text-sm text-soldier-alert">{error}</p>}
        {helperText && !error && (
          <p className="mt-1 text-sm text-gray-500">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
