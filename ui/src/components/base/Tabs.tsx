/**
 * Tabs Component
 * Tab navigation
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  activeTab?: string;
  onChange?: (tabId: string) => void;
  variant?: 'default' | 'pills' | 'underline';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeStyles = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-base px-4 py-2',
  lg: 'text-lg px-5 py-2.5',
};

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab: controlledActiveTab,
  onChange,
  variant = 'default',
  size = 'md',
  className = '',
}) => {
  const [internalActiveTab, setInternalActiveTab] = useState(tabs[0]?.id);
  const activeTab = controlledActiveTab ?? internalActiveTab;

  const handleTabClick = (tabId: string) => {
    if (onChange) {
      onChange(tabId);
    } else {
      setInternalActiveTab(tabId);
    }
  };

  const renderTab = (tab: Tab) => {
    const isActive = activeTab === tab.id;

    if (variant === 'pills') {
      return (
        <button
          key={tab.id}
          onClick={() => handleTabClick(tab.id)}
          disabled={tab.disabled}
          className={`relative ${sizeStyles[size]} font-medium rounded-lg transition-all duration-200 ${
            isActive
              ? 'bg-queen-amber text-chamber-dark'
              : 'text-gray-400 hover:text-white hover:bg-chamber-wall/50'
          } ${tab.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className="flex items-center gap-2">
            {tab.icon}
            {tab.label}
          </span>
        </button>
      );
    }

    if (variant === 'underline') {
      return (
        <button
          key={tab.id}
          onClick={() => handleTabClick(tab.id)}
          disabled={tab.disabled}
          className={`relative ${sizeStyles[size]} font-medium transition-colors duration-200 ${
            isActive ? 'text-queen-amber' : 'text-gray-400 hover:text-white'
          } ${tab.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className="flex items-center gap-2">
            {tab.icon}
            {tab.label}
          </span>
          {isActive && (
            <motion.div
              layoutId="tab-underline"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-queen-amber"
            />
          )}
        </button>
      );
    }

    // Default variant
    return (
      <button
        key={tab.id}
        onClick={() => handleTabClick(tab.id)}
        disabled={tab.disabled}
        className={`relative ${sizeStyles[size]} font-medium rounded-t-lg border-b-2 transition-all duration-200 ${
          isActive
            ? 'bg-chamber-tunnel border-queen-amber text-white'
            : 'border-transparent text-gray-400 hover:text-white hover:bg-chamber-wall/30'
        } ${tab.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className="flex items-center gap-2">
          {tab.icon}
          {tab.label}
        </span>
      </button>
    );
  };

  return (
    <div
      className={`flex ${
        variant === 'underline' ? 'border-b border-chamber-wall' : 'gap-1'
      } ${className}`}
    >
      {tabs.map(renderTab)}
    </div>
  );
};

interface TabPanelProps {
  children: React.ReactNode;
  tabId: string;
  activeTab: string;
  className?: string;
}

export const TabPanel: React.FC<TabPanelProps> = ({
  children,
  tabId,
  activeTab,
  className = '',
}) => {
  if (tabId !== activeTab) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {children}
    </motion.div>
  );
};
