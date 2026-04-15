import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopCommandBar } from './TopCommandBar';
import { MobileNav } from './MobileNav';
import { MobileOverflowDrawer } from './MobileOverflowDrawer';
import { HealthBanner } from '../components/shared/HealthBanner';

export const DashboardLayout = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: 'var(--color-bg-deep)',
      }}
    >
      <HealthBanner />
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopCommandBar />

        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      <MobileNav onMorePress={() => setDrawerOpen(true)} />
      <MobileOverflowDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
};
