import type { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padding?: string;
  onClick?: () => void;
}

export const GlassCard = ({
  children,
  className = '',
  hover = false,
  padding = 'p-5 sm:p-8',
  onClick,
}: GlassCardProps) => (
  <div
    className={`glass-card ${padding} ${hover ? '' : 'hover:border-[rgba(255,255,255,0.08)] hover:shadow-[var(--shadow-glass)]'} ${className}`}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
  >
    {children}
  </div>
);
