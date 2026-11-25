import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  appleProvider,
  auth,
  BOOTSTRAP_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  supabaseApiFetch,
} from '../lib/supabase';
import { RovaUser, UserRole } from '../types/rova';

export interface RovaAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  providerData: Array<{ providerId: string; email?: string | null }>;
}

interface AuthContextValue {
  firebaseUser: RovaAuthUser | null;
  profile: RovaUser | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  isAdmin: boolean;
  authBackend: 'supabase' | 'firebase';
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  logout: () => Promise<void>;
  completeOnboarding: (role: UserRole, displayName: string, phone: string) => Promise<void>;
  updateProfileFields: (
    fields: Partial<Pick<RovaUser, 'displayName' | 'phone' | 'businessId' | 'role'>>
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapFirebaseUser(u: FirebaseUser | null): RovaAuthUser | null {
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
    emailVerified: u.emailVerified,
    providerData: (u.providerData || []).map((p) => ({
      providerId: p.providerId,
      email: p.email,
    })),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const useSupabase = isSupabaseConfigured();
  const [firebaseUser, setFirebaseUser] = useState<RovaAuthUser | null>(null);
  const [profile, setProfile] = useState<RovaUser | null>(null);
  const [isAdminDoc, setIsAdminDoc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (useSupabase) {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      let active = true;

      const syncSupabaseUser = async () => {
        const { data } = await supabase.auth.getSession();
        const sbUser = data.session?.user || null;
        if (!active) return;

        if (!sbUser) {
          setFirebaseUser(null);
          setProfile(null);
          setIsAdminDoc(false);
          setLoading(false);
          return;
        }

        const provider = String(sbUser.app_metadata?.provider || 'google');
        setFirebaseUser({
          uid: sbUser.id,
          email: sbUser.email || null,
          displayName:
            (sbUser.user_metadata?.full_name as string | undefined) ||
            (sbUser.user_metadata?.name as string | undefined) ||
            null,
          photoURL:
            (sbUser.user_metadata?.avatar_url as string | undefined) ||
            (sbUser.user_metadata?.picture as string | undefined) ||
            null,
          emailVerified: Boolean(sbUser.email_confirmed_at),
          providerData: [{ providerId: provider === 'apple' ? 'apple.com' : 'google.com', email: sbUser.email }],
        });

        try {
          const res = await supabaseApiFetch<{ profile: RovaUser | null; isAdmin: boolean }>('/api/v1/me');
          if (!active) return;
          setProfile(res.profile);
          setIsAdminDoc(Boolean(res.isAdmin));
        } catch {
          // Fallback to direct RLS-protected user read if serverless API is warming up
          const { data: row } = await supabase
            .from('users')
            .select('*')
            .eq('uid', sbUser.id)
            .maybeSingle();
          if (!active) return;
          if (row) {
            setProfile({
              uid: row.uid,
              email: row.email,
              displayName: row.display_name,
              phone: row.phone || undefined,
              role: row.role,
              businessId: row.business_id || undefined,
            });
          } else {
            setProfile(null);
          }
        } finally {
          if (active) setLoading(false);
        }
      };

      void syncSupabaseUser();
      const { data: sub } = supabase.auth.onAuthStateChange(() => {
        void syncSupabaseUser();
      });

      return () => {
        active = false;
        sub.subscription.unsubscribe();
      };
    }

    // Default Firebase Auth + Firestore profile listener
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setFirebaseUser(mapFirebaseUser(fbUser));
      setAuthError(null);

      if (!fbUser) {
        setProfile(null);
        setIsAdminDoc(false);
        setLoading(false);
        return;
      }

      try {
        const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        setIsAdminDoc(adminSnap.exists());
      } catch {
        setIsAdminDoc(false);
      }

      const userPath = `users/${fbUser.uid}`;
      unsubProfile = onSnapshot(
        doc(db, 'users', fbUser.uid),
        (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as RovaUser);
          } else {
            setProfile(null);
          }
          setLoading(false);
        },
        (error) => {
          setLoading(false);
          handleFirestoreError(error, OperationType.GET, userPath);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, [useSupabase]);

  const isBootstrapAdmin = Boolean(
    firebaseUser?.email === BOOTSTRAP_ADMIN_EMAIL && firebaseUser?.emailVerified
  );

  const isAdmin =
    isBootstrapAdmin ||
    isAdminDoc ||
    profile?.role === 'admin' ||
    profile?.role === 'super_admin' ||
    profile?.role === 'operations_manager' ||
    profile?.role === 'dispatcher';

  const clearAuthError = () => setAuthError(null);

  const formatAuthError = (err: unknown, providerName: 'Google' | 'Apple'): string => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return `Connexion ${providerName} annulée.`;
    }
    if (code === 'auth/popup-blocked') {
      return `Votre navigateur a bloqué la fenêtre de connexion ${providerName}. Autorisez les popups pour continuer.`;
    }
    if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
      return providerName === 'Apple'
        ? 'La connexion Apple doit être activée dans votre fournisseur d’authentification.'
        : 'La connexion Google n’est pas activée dans votre fournisseur d’authentification.';
    }
    if (code === 'auth/account-exists-with-different-credential') {
      return 'Un compte existe déjà avec cette adresse e-mail via un autre mode de connexion.';
    }
    return err instanceof Error ? err.message : `Impossible de se connecter avec ${providerName}.`;
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    if (useSupabase) {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        setAuthError(formatAuthError(error, 'Google'));
        throw error;
      }
      return;
    }

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(formatAuthError(err, 'Google'));
      throw err;
    }
  };

  const signInWithApple = async () => {
    setAuthError(null);
    if (useSupabase) {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        setAuthError(formatAuthError(error, 'Apple'));
        throw error;
      }
      return;
    }

    try {
      await signInWithPopup(auth, appleProvider);
    } catch (err) {
      setAuthError(formatAuthError(err, 'Apple'));
      throw err;
    }
  };

  const logout = async () => {
    if (useSupabase) {
      const supabase = getSupabaseClient();
      if (supabase) await supabase.auth.signOut();
      setFirebaseUser(null);
      setProfile(null);
      return;
    }
    await signOut(auth);
    setProfile(null);
  };

  const completeOnboarding = async (role: UserRole, displayName: string, phone: string) => {
    if (!firebaseUser) return;
    const cleanName = displayName.trim().slice(0, 120) || firebaseUser.displayName || 'ROVA User';
    const cleanPhone = phone.trim().slice(0, 40);
    const assignedRole: UserRole =
      isBootstrapAdmin && role === 'super_admin' ? 'super_admin' : role;

    if (useSupabase) {
      const res = await supabaseApiFetch<{ profile: RovaUser }>('/api/v1/me', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: cleanName,
          phone: cleanPhone,
          role: assignedRole,
        }),
      });
      setProfile(res.profile);
      return;
    }

    const path = `users/${firebaseUser.uid}`;
    try {
      await setDoc(doc(db, 'users', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: cleanName,
        ...(cleanPhone ? { phone: cleanPhone } : {}),
        role: assignedRole,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const updateProfileFields = async (
    fields: Partial<Pick<RovaUser, 'displayName' | 'phone' | 'businessId' | 'role'>>
  ) => {
    if (!firebaseUser) return;

    if (useSupabase) {
      const res = await supabaseApiFetch<{ profile: RovaUser }>('/api/v1/me', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: fields.displayName ?? profile?.displayName ?? firebaseUser.displayName ?? 'ROVA User',
          phone: fields.phone ?? profile?.phone,
          businessId: fields.businessId ?? profile?.businessId,
          role: fields.role ?? profile?.role ?? 'merchant',
        }),
      });
      setProfile(res.profile);
      return;
    }

    const path = `users/${firebaseUser.uid}`;
    try {
      const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (fields.displayName !== undefined) payload.displayName = fields.displayName.trim().slice(0, 120);
      if (fields.phone !== undefined) payload.phone = fields.phone.trim().slice(0, 40);
      if (fields.businessId !== undefined) payload.businessId = fields.businessId.slice(0, 128);
      if (fields.role !== undefined) payload.role = fields.role;
      await updateDoc(doc(db, 'users', firebaseUser.uid), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        authError,
        clearAuthError,
        isAdmin,
        authBackend: useSupabase ? 'supabase' : 'firebase',
        signInWithGoogle,
        signInWithApple,
        logout,
        completeOnboarding,
        updateProfileFields,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
