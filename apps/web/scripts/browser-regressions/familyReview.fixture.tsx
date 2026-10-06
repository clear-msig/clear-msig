"use client";
import { lazy, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { ActionNeededProvider } from '@/lib/hooks/useActionNeeded';
import { RouteSkeleton } from '@/components/retail/RouteSkeleton';
const screens = {
 settings: lazy(()=>import('@/features/settings/routes/AppSettingsPage')),
 contacts: lazy(()=>import('@/app/app/contacts/page')),
 activity: lazy(()=>import('@/app/app/activity/page')),
 recovery: lazy(()=>import('@/app/app/secure/page')),
 recoverynew: lazy(()=>import('@/features/secure/routes/NewRecoveryPage')),
 agents: lazy(()=>import('@/features/agents/routes/AgentDashboardPage')),
 send: lazy(()=>import('@/features/send/routes/SolanaSendPage')),
 payments: lazy(()=>import('@/app/app/wallet/[name]/buy/page')),
 governance: lazy(()=>import('@/app/app/proposals/page')),
 onboarding: lazy(()=>import('@/app/app/wallet/new/page')),
 dashboard: lazy(()=>import('@/features/wallet/routes/WalletHomePage')),
};
export default function Review(){const {view}=useParams();const Page=screens[view as keyof typeof screens];return <main className="min-h-screen bg-canvas px-6 py-8 text-text-strong"><div className="mx-auto max-w-6xl"><p className="mb-8 border-b border-border-soft pb-5 text-sm">LOCAL REVIEW · Disconnected providers · No live accounts or transactions</p><ActionNeededProvider><Suspense fallback={<RouteSkeleton/>}>{Page?<Page/>:<RouteSkeleton/>}</Suspense></ActionNeededProvider></div></main>}
