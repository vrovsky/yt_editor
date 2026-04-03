import React, { createContext, useContext } from 'react';
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser } from '@clerk/clerk-react';

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

const SubscriptionTierContext = createContext<SubscriptionTier>('free');

export function useSubscriptionTier(): SubscriptionTier {
  return useContext(SubscriptionTierContext);
}

function SubscriptionTierFromClerk({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const tier = (user?.publicMetadata?.tier as SubscriptionTier) ?? 'free';
  return (
    <SubscriptionTierContext.Provider value={tier}>
      {children}
    </SubscriptionTierContext.Provider>
  );
}

export function useCanExport(): boolean {
  const tier = useSubscriptionTier();
  return tier === 'pro' || tier === 'enterprise';
}

export function useCanGenerate(): boolean {
  const tier = useSubscriptionTier();
  return tier === 'free' || tier === 'pro' || tier === 'enterprise';
}

export function useMaxVideoSizeMb(): number {
  const tier = useSubscriptionTier();
  switch (tier) {
    case 'enterprise': return 4096;
    case 'pro': return 1024;
    default: return 256;
  }
}

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>
    <SignedIn>
      <SubscriptionTierFromClerk>{children}</SubscriptionTierFromClerk>
    </SignedIn>
    <SignedOut>
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
      }}>
        <div style={{ fontSize: 48 }}>✂</div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>AI Video Editor</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 320 }}>
          Sign in to create AI-powered edits with YouTuber style profiles.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <SignInButton mode="modal">
            <button className="btn btn-action" style={{ padding: '10px 20px', fontSize: 14 }}>
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="btn btn-ghost" style={{ padding: '10px 20px', fontSize: 14 }}>
              Sign Up
            </button>
          </SignUpButton>
        </div>
      </div>
    </SignedOut>
  </>
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return (
      <SubscriptionTierContext.Provider value="free">
        {children}
      </SubscriptionTierContext.Provider>
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl={window.location.origin}
    >
      <AuthGate>{children}</AuthGate>
    </ClerkProvider>
  );
}

export function HeaderUserButton() {
  const hasClerk = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!hasClerk) {
    return (
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        Demo
      </span>
    );
  }
  return (
    <SignedIn>
      <UserButton
        afterSignOutUrl={window.location.origin}
        appearance={{
          elements: {
            avatarBox: 'w-8 h-8',
          },
        }}
      />
    </SignedIn>
  );
}
