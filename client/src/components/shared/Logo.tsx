const M = 'Montserrat, sans-serif';

interface LogoProps {
  collapsed?: boolean;
}

export const Logo = ({ collapsed = false }: LogoProps) => (
  <div className="flex items-center gap-3" style={{ fontFamily: M }}>
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{
        width: 32,
        height: 32,
        transform: 'rotate(45deg)',
        borderRadius: 6,
        background: 'linear-gradient(135deg, #0E7C7B, #12A5A4)',
        boxShadow: '0 0 16px rgba(14, 124, 123, 0.3)',
      }}
    >
      <span
        className="text-white font-bold text-xs"
        style={{
          transform: 'rotate(-45deg)',
          fontFamily: M,
          letterSpacing: '0.5px',
        }}
      >
        JSC
      </span>
    </div>
    {!collapsed && (
      <span
        className="text-sm font-semibold whitespace-nowrap"
        style={{ color: 'var(--color-text-primary)', fontFamily: M }}
      >
        JStudio Command Center
      </span>
    )}
  </div>
);
