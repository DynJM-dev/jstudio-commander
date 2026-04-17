import { useLocation, useNavigate } from 'react-router-dom';
import {
  Monitor,
  MessageSquare,
  FolderKanban,
  BarChart3,
  MoreHorizontal,
} from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Phase P.3 H4 — Terminal tab replaced by Analytics. Terminal page is
// gone pending a future xterm.js/node-pty rebuild; Analytics was
// previously behind the "More" overflow and surfaces account-level
// numbers the user actually reaches for.
const TABS = [
  { path: '/sessions', icon: Monitor, label: 'Sessions' },
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/projects', icon: FolderKanban, label: 'Projects' },
  { path: '/analytics', icon: BarChart3, label: 'Analytics' },
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
        // Total nav height grows by the safe-area inset (iPhone home
        // indicator ≈ 34px) so the 64px content area is preserved and
        // tap targets stay at 44px instead of getting squeezed.
        height: 'calc(64px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        fontFamily: M,
        background: 'rgba(15, 20, 25, 0.92)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
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
