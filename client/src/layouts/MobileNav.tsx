import { useLocation, useNavigate } from 'react-router-dom';
import {
  Monitor,
  MessageSquare,
  FolderKanban,
  TerminalSquare,
  MoreHorizontal,
} from 'lucide-react';

const M = 'Montserrat, sans-serif';

const TABS = [
  { path: '/sessions', icon: Monitor, label: 'Sessions' },
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/projects', icon: FolderKanban, label: 'Projects' },
  { path: '/terminal', icon: TerminalSquare, label: 'Terminal' },
];

interface MobileNavProps {
  onMorePress: () => void;
}

export const MobileNav = ({ onMorePress }: MobileNavProps) => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 lg:hidden flex items-stretch justify-around"
      style={{
        height: 64,
        fontFamily: M,
        background: 'rgba(15, 20, 25, 0.92)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map(({ path, icon: Icon, label }) => {
        const active = location.pathname === path || location.pathname.startsWith(path + '/');
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="flex flex-col items-center justify-center flex-1 gap-0.5 transition-colors"
            style={{
              minHeight: 44,
              color: active ? 'var(--color-accent-light)' : 'var(--color-text-tertiary)',
            }}
          >
            <Icon size={20} strokeWidth={active ? 2 : 1.6} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}

      {/* More button */}
      <button
        onClick={onMorePress}
        className="flex flex-col items-center justify-center flex-1 gap-0.5 transition-colors"
        style={{
          minHeight: 44,
          color: 'var(--color-text-tertiary)',
        }}
      >
        <MoreHorizontal size={20} strokeWidth={1.6} />
        <span className="text-[10px] font-medium">More</span>
      </button>
    </nav>
  );
};
