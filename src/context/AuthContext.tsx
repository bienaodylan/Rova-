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
import { RovaUser, UserRole } from '../types/rova';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  profile: RovaUser | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  isAdmin: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  logout: () => Promise<void>;
  completeOnboarding: (role: UserRole, displayName: string, phone: string) => Promise<void>;
  updateProfileFields: (fields: Partial<Pick<RovaUser, 'displayName' | 'phone' | 'businessId' | 'role'>>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<RovaUser | null>(null);
  const [isAdminDoc, setIsAdminDoc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setFirebaseUser(fbUser);
      setAuthError(null);

      if (!fbUser) {
        setProfile(null);
        setIsAdminDoc(false);
        setLoading(false);
        return;
      }

      // Check trusted admins/{uid} doc if not bootstrap email
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
  }, []);

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
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: string }).code) : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return `Connexion ${providerName} annulée.`;
    }
    if (code === 'auth/popup-blocked') {
      return `Votre navigateur a bloqué la fenêtre de connexion ${providerName}. Autorisez les popups pour continuer.`;
    }
    if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
      return providerName === 'Apple'
        ? 'La connexion Apple doit être activée dans la console Firebase (Authentication → Sign-in method → Apple).'
        : 'La connexion Google n’est pas activée dans la console Firebase.';
    }
    if (code === 'auth/account-exists-with-different-credential') {
      return 'Un compte existe déjà avec cette adresse e-mail via un autre mode de connexion.';
    }
    return err instanceof Error ? err.message : `Impossible de se connecter avec ${providerName}.`;
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(formatAuthError(err, 'Google'));
      throw err;
    }
  };

  const signInWithApple = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, appleProvider);
    } catch (err) {
      setAuthError(formatAuthError(err, 'Apple'));
      throw err;
    }
  };

  const logout = async () => {
    await signOut(auth);
    setProfile(null);
  };

  const completeOnboarding = async (role: UserRole, displayName: string, phone: string) => {
    if (!firebaseUser) return;
    const cleanName = displayName.trim().slice(0, 120) || firebaseUser.displayName || 'ROVA User';
    const cleanPhone = phone.trim().slice(0, 40);
    const assignedRole: UserRole =
      isBootstrapAdmin && role === 'super_admin' ? 'super_admin' : role;
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
