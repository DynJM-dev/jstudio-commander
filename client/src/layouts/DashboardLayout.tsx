import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopCommandBar } from './TopCommandBar';
import { MobileNav } from './MobileNav';
import { MobileOverflowDrawer } from './MobileOverflowDrawer';

export const DashboardLayout = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div
      className="flex min-h-screen"
      style={{
        background: 'var(--color-bg-deep)',
        overflowX: 'hidden',
      }}
    >
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <TopCommandBar />

        <main className="flex-1 pb-24 lg:pb-6">
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
