import React, { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  KeyRound,
  Loader2,
  LogOut,
  MessageSquare,
  Send,
  Shield,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useRovaApp } from '../../context/RovaAppContext';
import { BottomSheet } from '../BottomSheet';

// ============================================================================
// 6. SÉCURITÉ ET CONFIDENTIALITÉ
// ============================================================================
export function SecuritySection() {
  const { firebaseUser, logout } = useAuth();
  const { t } = useLanguage();
  const { submitSupportMessage, showToast, requestSignIn, busy } = useRovaApp();

  const [resetSending, setResetSending] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const providers = firebaseUser?.providerData?.map((p) => p.providerId) || [];
  const hasPasswordProvider = providers.includes('password');
  const providerLabels = providers.map((id) => {
    if (id === 'google.com') return 'Google';
    if (id === 'apple.com') return 'Apple';
    if (id === 'password') return t('E-mail & mot de passe', 'Email & password');
    return id;
  });

  const handlePasswordReset = async () => {
    if (!firebaseUser?.email) return;
    setResetSending(true);
    try {
      await sendPasswordResetEmail(auth, firebaseUser.email);
      showToast(
        t(
          `E-mail de réinitialisation envoyé à ${firebaseUser.email}.`,
          `Password reset email sent to ${firebaseUser.email}.`
        ),
        'success'
      );
    } catch {
      showToast(
        t('Impossible d’envoyer l’e-mail de réinitialisation.', 'Could not send password reset email.'),
        'error'
      );
    } finally {
      setResetSending(false);
    }
  };

  const handleRequestAccountDeletion = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'SUPPRIMER') return;
    setSubmittingDelete(true);
    try {
      await submitSupportMessage({
        category: 'dispute',
        description: `[ACCOUNT_DELETION_REQUEST] Demande explicite de suppression du compte utilisateur (${firebaseUser?.email || firebaseUser?.uid || 'unknown'}).`,
      });
      setDeleteModalOpen(false);
      setDeleteConfirmText('');
      await logout();
      showToast(
        t(
          'Votre demande de suppression de compte a été enregistrée et votre session fermée.',
          'Your account deletion request has been logged and your session signed out.'
        ),
        'info'
      );
    } finally {
      setSubmittingDelete(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="pb-5 border-b border-neutral-200/80">
        <h2 className="font-display text-xl font-bold tracking-tight text-neutral-950">
          {t('Sécurité et confidentialité', 'Security & privacy')}
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          {t(
            'Authentification, sessions actives, protection des données et gestion du compte.',
            'Authentication, active sessions, data privacy, and account lifecycle.'
          )}
        </p>
      </div>

      {!firebaseUser ? (
        <div className="py-8 space-y-3 border-b border-neutral-200/70">
          <p className="text-sm text-neutral-600">
            {t('Connectez-vous pour gérer la sécurité de votre compte.', 'Sign in to manage account security.')}
          </p>
          <button
            type="button"
            onClick={() => void requestSignIn()}
            className="px-5 py-2.5 rounded-full bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            {t('Se connecter', 'Sign in')}
          </button>
        </div>
      ) : (
        <div className="divide-y divide-neutral-200/70 border-b border-neutral-200/70">
          {/* Authentication Method & Verification */}
          <div className="py-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-neutral-950 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-neutral-600" />
                <span>{t('Méthode de connexion', 'Sign-in method')}</span>
              </p>
              <p className="text-xs text-neutral-500 pl-6">
                {providerLabels.length > 0 ? providerLabels.join(' · ') : 'Firebase Auth'} ·{' '}
                {firebaseUser.emailVerified
                  ? t('Compte vérifié', 'Verified account')
                  : t('Vérification en attente', 'Verification pending')}
              </p>
            </div>
            <span className="font-mono text-[11px] text-neutral-400">
              ID {firebaseUser.uid.slice(0, 8)}
            </span>
          </div>

          {/* Password management */}
          <div className="py-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5 max-w-md">
              <p className="text-sm font-semibold text-neutral-950 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-neutral-600" />
                <span>{t('Mot de passe', 'Password')}</span>
              </p>
              <p className="text-xs text-neutral-500 pl-6">
                {hasPasswordProvider
                  ? t(
                      'Recevez un lien sécurisé par e-mail pour définir un nouveau mot de passe.',
                      'Receive a secure email link to set a new password.'
                    )
                  : t(
                      `Votre accès est protégé directement par ${providerLabels.join(' / ') || 'votre fournisseur SSO'}. Aucun mot de passe ROVA distinct n’est requis.`,
                      `Your sign-in is secured directly by ${providerLabels.join(' / ') || 'your SSO provider'}. No separate ROVA password is needed.`
                    )}
              </p>
            </div>
            {hasPasswordProvider && (
              <button
                type="button"
                disabled={resetSending}
                onClick={() => void handlePasswordReset()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-300 hover:border-neutral-950 text-xs font-medium text-neutral-900 transition-colors cursor-pointer disabled:opacity-40"
              >
                {resetSending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{t('Réinitialiser', 'Reset password')}</span>
              </button>
            )}
          </div>

          {/* Active Session & Sign Out */}
          <div className="py-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-neutral-950">
                {t('Session active sur cet appareil', 'Active session on this device')}
              </p>
              <p className="text-xs text-neutral-500">
                {firebaseUser.email} · {t('Connecté maintenant', 'Signed in now')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-300 hover:border-neutral-950 text-xs font-semibold text-neutral-950 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('Se déconnecter', 'Sign out')}</span>
            </button>
          </div>

          {/* Privacy overview */}
          <div className="py-5 space-y-1.5">
            <p className="text-sm font-semibold text-neutral-950">
              {t('Confidentialité et protection des données', 'Privacy & data protection')}
            </p>
            <p className="text-xs text-neutral-500 leading-relaxed max-w-2xl">
              {t(
                'Les liens de suivi destinataires sont strictement isolés : ils n’exposent ni vos autres commandes, ni votre carnet d’adresses, ni vos informations de facturation. Les codes OTP de remise et coordonnées GPS sont protégés par les règles d’accès serveur ROVA.',
                'Recipient tracking links are strictly isolated: they never expose your other orders, saved addresses, or billing records. Delivery OTP codes and GPS coordinates are enforced by ROVA server access rules.'
              )}
            </p>
          </div>

          {/* Account Deletion Request */}
          <div className="py-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5 max-w-md">
              <p className="text-sm font-semibold text-red-700">
                {t('Supprimer mon compte', 'Delete my account')}
              </p>
              <p className="text-xs text-neutral-500">
                {t(
                  'Clôture de votre accès et traitement de l’effacement de vos données personnelles conformément aux obligations légales de traçabilité.',
                  'Closes your access and initiates personal data erasure in compliance with delivery audit obligations.'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteModalOpen(true)}
              className="px-4 py-2 rounded-full border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              {t('Demander la suppression', 'Request deletion')}
            </button>
          </div>
        </div>
      )}

      {/* Explicit Account Deletion Confirmation Modal */}
      <BottomSheet
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setDeleteConfirmText('');
        }}
        size="sm"
        title={t('Confirmer la suppression du compte', 'Confirm account deletion')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDeleteModalOpen(false);
                setDeleteConfirmText('');
              }}
              className="px-4 py-2.5 rounded-full border border-neutral-200 text-xs font-medium text-neutral-700 hover:border-neutral-950 transition-colors cursor-pointer"
            >
              {t('Annuler', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={
                submittingDelete ||
                busy ||
                deleteConfirmText.trim().toUpperCase() !== 'SUPPRIMER'
              }
              onClick={() => void handleRequestAccountDeletion()}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-40 transition-colors cursor-pointer"
            >
              {submittingDelete && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('Confirmer et déconnecter', 'Confirm & sign out')}</span>
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {t(
                'Cette action transmet une demande irréversible de clôture de votre compte ROVA et ferme immédiatement votre session.',
                'This submits a permanent ROVA account closure request and immediately signs you out.'
              )}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1.5">
              {t('Saisissez SUPPRIMER pour confirmer', 'Type SUPPRIMER to confirm')}
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="SUPPRIMER"
              className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-red-600"
            />
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

// ============================================================================
// 7. ASSISTANCE
// ============================================================================
export function SupportSection() {
  const { t } = useLanguage();
  const { openSupportSheet } = useRovaApp();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const faqs = [
    {
      q: t('Comment suivre une livraison en temps réel ?', 'How do I track a delivery live?'),
      a: t(
        'Ouvrez l’onglet Expéditions puis basculez sur « Carte » ou touchez une course pour voir son trajet, son statut et la position du livreur.',
        'Open the Shipments tab and switch to Map view or tap any order to inspect its live route, status, and courier position.'
      ),
    },
    {
      q: t('Comment fonctionne le code OTP de remise ?', 'How does OTP proof of delivery work?'),
      a: t(
        'Chaque arrêt génère un code unique communiqué au destinataire. Le livreur saisit ce code lors de la remise pour horodater et sécuriser la preuve de livraison.',
        'Every stop generates a unique handover code shared with the recipient. The driver enters it on arrival to verify and timestamp delivery.'
      ),
    },
    {
      q: t('Puis-je planifier une tournée avec plusieurs arrêts ?', 'Can I schedule a multi-stop route?'),
      a: t(
        'Oui. Choisissez « Tournée multi-arrêts » depuis l’accueil, ajoutez vos destinataires manuellement ou par fichier CSV, puis cliquez sur « Optimiser » pour ordonner le parcours.',
        'Yes. Pick Multi-stop delivery from Home, add stops manually or via CSV import, and tap Optimize to sequence the route.'
      ),
    },
    {
      q: t('Pourquoi la devise d’affichage peut-elle différer du reçu ?', 'Why can display currency differ from the billed receipt?'),
      a: t(
        'La devise d’affichage dans Préférences facilite la lecture locale. Chaque commande reste toutefois enregistrée dans sa devise d’origine pour garantir la précision comptable.',
        'Display currency in Preferences helps you estimate prices locally, while every billed order retains its exact original settlement currency.'
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="pb-5 border-b border-neutral-200/80">
        <h2 className="font-display text-xl font-bold tracking-tight text-neutral-950">
          {t('Assistance', 'Help & support')}
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          {t(
            'Centre d’aide, questions fréquentes et contact direct avec les opérations ROVA.',
            'Help center, frequently asked questions, and direct ROVA Operations support.'
          )}
        </p>
      </div>

      {/* Direct Support Actions */}
      <div className="divide-y divide-neutral-200/70 border-b border-neutral-200/70">
        <button
          type="button"
          onClick={() => openSupportSheet()}
          className="w-full py-4 px-1 text-left flex items-center justify-between gap-4 hover:bg-neutral-100/60 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <MessageSquare className="w-4 h-4 text-neutral-700 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950">
                {t('Contacter le support ROVA', 'Contact ROVA support')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t('Une question sur votre compte, un tarif ou une commande en cours.', 'Questions about your account, pricing, or an active order.')}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => openSupportSheet()}
          className="w-full py-4 px-1 text-left flex items-center justify-between gap-4 hover:bg-neutral-100/60 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <HelpCircle className="w-4 h-4 text-red-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950">
                {t('Signaler un problème ou un incident', 'Report a delivery issue or incident')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t('Retard, colis endommagé, litige ou demande de remboursement.', 'Delay, damaged parcel, dispute, or refund request.')}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
        </button>
      </div>

      {/* Concise FAQ Accordion */}
      <div className="space-y-2">
        <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-500">
          {t('Questions fréquentes', 'Frequently asked questions')}
        </h3>
        <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70">
          {faqs.map((item, idx) => {
            const expanded = openFaq === idx;
            return (
              <div key={idx} className="py-3.5">
                <button
                  type="button"
                  onClick={() => setOpenFaq(expanded ? null : idx)}
                  className="w-full text-left flex items-center justify-between gap-3 cursor-pointer"
                >
                  <span className="text-sm font-medium text-neutral-950">{item.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${
                      expanded ? 'rotate-180 text-neutral-950' : ''
                    }`}
                  />
                </button>
                {expanded && (
                  <p className="text-xs text-neutral-600 leading-relaxed pt-2.5 pr-6">
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 8. INFORMATIONS LÉGALES + ACCÈS ESPACES ROVA
// ============================================================================
export function LegalSection({
  onOpenWorkspace,
}: {
  onOpenWorkspace: (workspace: 'driver' | 'operations' | 'tracking') => void;
}) {
  const { t, region } = useLanguage();
  const [activeDoc, setActiveDoc] = useState<'terms' | 'privacy' | 'about' | null>(null);

  return (
    <div className="space-y-8">
      <div className="pb-5 border-b border-neutral-200/80">
        <h2 className="font-display text-xl font-bold tracking-tight text-neutral-950">
          {t('Informations légales', 'Legal information')}
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          {t(
            'Conditions d’utilisation, politique de confidentialité et informations sur ROVA.',
            'Terms of service, privacy policy, and information about ROVA.'
          )}
        </p>
      </div>

      {/* Legal Documents */}
      <div className="divide-y divide-neutral-200/70 border-b border-neutral-200/70">
        {[
          {
            id: 'terms' as const,
            title: t('Conditions générales d’utilisation', 'Terms of Service'),
            subtitle: t('Règles d’expédition, tarifs, responsabilités et annulations.', 'Shipping terms, pricing, liabilities, and cancellations.'),
          },
          {
            id: 'privacy' as const,
            title: t('Politique de confidentialité', 'Privacy Policy'),
            subtitle: t('Collecte des adresses, géolocalisation et conservation des preuves.', 'Address data, geolocation handling, and proof retention.'),
          },
          {
            id: 'about' as const,
            title: t('À propos de ROVA', 'About ROVA'),
            subtitle: t(`Plateforme logistique urbaine · Région active : ${region.countryName}`, `Urban logistics platform · Active region: ${region.countryName}`),
          },
        ].map((docItem) => (
          <button
            key={docItem.id}
            type="button"
            onClick={() => setActiveDoc(docItem.id)}
            className="w-full py-4 px-1 text-left flex items-center justify-between gap-4 hover:bg-neutral-100/60 transition-colors cursor-pointer"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950">{docItem.title}</p>
              <p className="text-xs text-neutral-500 mt-0.5">{docItem.subtitle}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
          </button>
        ))}
      </div>

      {/* Dedicated ROVA Workspaces (Preserved cleanly without clutter) */}
      <div className="space-y-2">
        <h3 className="text-xs font-mono uppercase tracking-wider text-neutral-500">
          {t('Autres espaces ROVA', 'Other ROVA workspaces')}
        </h3>
        <div className="divide-y divide-neutral-200/70 border-y border-neutral-200/70">
          {[
            {
              id: 'driver' as const,
              title: t('Application Livreur', 'Driver App'),
              subtitle: t('Radar GPS, courses assignées et preuves de livraison.', 'GPS radar, assigned runs, and delivery proofs.'),
              icon: Smartphone,
            },
            {
              id: 'operations' as const,
              title: t('Centre d’Opérations', 'Operations Center'),
              subtitle: t('Dispatch temps réel, validation des livreurs et grille tarifaire.', 'Live dispatch, driver verification, and pricing rules.'),
              icon: Shield,
            },
            {
              id: 'tracking' as const,
              title: t('Page de suivi destinataire', 'Recipient Tracking Page'),
              subtitle: t('Consultation publique d’un colis sans création de compte.', 'Isolated parcel tracking without login.'),
              icon: Send,
            },
          ].map((ws) => {
            const Icon = ws.icon;
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => onOpenWorkspace(ws.id)}
                className="w-full py-4 px-1 text-left flex items-center justify-between gap-4 hover:bg-neutral-100/60 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <Icon className="w-4 h-4 text-neutral-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-950 truncate">{ws.title}</p>
                    <p className="text-xs text-neutral-500 truncate mt-0.5">{ws.subtitle}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Legal Reader Sheet */}
      <BottomSheet
        open={Boolean(activeDoc)}
        onClose={() => setActiveDoc(null)}
        size="md"
        title={
          activeDoc === 'terms'
            ? t('Conditions générales d’utilisation', 'Terms of Service')
            : activeDoc === 'privacy'
            ? t('Politique de confidentialité', 'Privacy Policy')
            : t('À propos de ROVA', 'About ROVA')
        }
      >
        <div className="space-y-4 text-xs text-neutral-600 leading-relaxed">
          {activeDoc === 'terms' && (
            <>
              <p>
                {t(
                  'ROVA met en relation les expéditeurs, commerçants et livreurs partenaires pour l’acheminement de colis et la réservation de véhicules dédiés.',
                  'ROVA connects senders, merchants, and partner drivers for parcel delivery and dedicated vehicle bookings.'
                )}
              </p>
              <p>
                {t(
                  'Les tarifs affichés avant confirmation tiennent compte de la distance routière estimée, du type de véhicule, du nombre d’arrêts et des options choisies. Une expédition peut être annulée sans frais tant qu’elle est au statut « En attente » ou « Planifiée ».',
                  'Quotes displayed prior to confirmation reflect estimated road distance, vehicle class, stop count, and selected options. Deliveries may be cancelled while Pending or Scheduled.'
                )}
              </p>
              <p>
                {t(
                  'L’expéditeur garantit l’exactitude des coordonnées de collecte et de destination ainsi que la conformité légale des marchandises confiées.',
                  'Senders confirm the accuracy of pickup and delivery coordinates and the lawful nature of shipped items.'
                )}
              </p>
            </>
          )}

          {activeDoc === 'privacy' && (
            <>
              <p>
                {t(
                  'ROVA collecte uniquement les données nécessaires à l’exécution des livraisons : identité, coordonnées de contact, adresses de collecte/livraison, positions GPS lors des courses actives et preuves de remise.',
                  'ROVA collects only the information needed to fulfill deliveries: account identity, contact details, pickup/drop-off addresses, active trip GPS positions, and handover proofs.'
                )}
              </p>
              <p>
                {t(
                  'Les accès sont cloisonnés par rôle utilisateur. Aucun numéro de carte bancaire n’est stocké dans le navigateur ou dans la base applicative.',
                  'Access is strictly isolated per user role. No raw bank card numbers are stored in the browser or application database.'
                )}
              </p>
            </>
          )}

          {activeDoc === 'about' && (
            <>
              <p className="font-display text-sm font-bold text-neutral-950">ROVA Logistics Platform</p>
              <p>
                {t(
                  'Infrastructure de livraison urbaine et de gestion de tournées conçue pour les clients, commerçants et livreurs.',
                  'Urban delivery and multi-stop dispatch infrastructure designed for customers, merchants, and drivers.'
                )}
              </p>
              <p className="font-mono text-[11px] text-neutral-500">
                {t('Région active :', 'Active region:')} {region.city}, {region.countryName} ({region.countryCode})
              </p>
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
