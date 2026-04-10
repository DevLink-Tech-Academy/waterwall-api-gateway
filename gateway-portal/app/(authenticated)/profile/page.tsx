'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@gateway/shared-ui/lib/api-client';

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'http://localhost:8081';
const NOTIFICATION_URL = process.env.NEXT_PUBLIC_NOTIFICATION_URL || 'http://localhost:8084';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token')
    || localStorage.getItem('admin_token')
    || localStorage.getItem('jwt_token');
}

function identityFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${IDENTITY_URL}${path}`, { ...options, headers }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message || `Request failed (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  });
}

function notificationFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${NOTIFICATION_URL}${path}`, { ...options, headers }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message || `Request failed (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  });
}

interface UserProfile {
  displayName: string;
  email: string;
  phone: string;
  timezone: string;
}

interface MfaStatus {
  totpEnabled: boolean;
  emailOtpEnabled: boolean;
  recoveryCodesRemaining: number;
}

interface TotpSetupResponse {
  qrCodeDataUrl: string;
  secret: string;
  recoveryCodes: string[];
}

interface Webhook {
  id: string;
  url: string;
  active: boolean;
  secret?: string;
  createdAt: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile>({ displayName: '', email: '', phone: '', timezone: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password change
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // MFA
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaError, setMfaError] = useState('');
  const [mfaSuccess, setMfaSuccess] = useState('');
  const [totpSetup, setTotpSetup] = useState<TotpSetupResponse | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [verifyingTotp, setVerifyingTotp] = useState(false);
  const [settingUpTotp, setSettingUpTotp] = useState(false);

  // Webhooks
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhookError, setWebhookError] = useState('');
  const [webhookSuccess, setWebhookSuccess] = useState('');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [addingWebhook, setAddingWebhook] = useState(false);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [newWebhookSecret, setNewWebhookSecret] = useState('');
  const [activeProfileTab, setActiveProfileTab] = useState<'profile' | 'security' | 'webhooks'>('profile');

  const fetchMfaStatus = useCallback(async () => {
    try {
      const data = await identityFetch<MfaStatus>('/v1/mfa/status');
      setMfaStatus(data);
    } catch {
      // MFA status may not be available
    }
  }, []);

  const fetchWebhooks = useCallback(async () => {
    try {
      const data = await notificationFetch<Webhook[]>('/v1/webhooks');
      setWebhooks(Array.isArray(data) ? data : []);
    } catch {
      // Webhooks may not be available
    }
  }, []);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const data = await apiClient<UserProfile>('/v1/users/me');
        setProfile(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
    fetchMfaStatus();
    fetchWebhooks();
  }, [fetchMfaStatus, fetchWebhooks]);

  const handleSaveProfile = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiClient('/v1/users/me', {
        method: 'PUT',
        body: JSON.stringify(profile),
      });
      setSuccess('Profile updated successfully');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    setChangingPassword(true);
    try {
      await apiClient('/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      setPasswordSuccess('Password changed successfully');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, borderRadius: 999, backgroundColor: '#e2e8f0', animation: 'pulse 1.5s infinite' }} />
          <div>
            <div style={{ width: 160, height: 20, borderRadius: 6, backgroundColor: '#e2e8f0', marginBottom: 8, animation: 'pulse 1.5s infinite' }} />
            <div style={{ width: 200, height: 14, borderRadius: 6, backgroundColor: '#f1f5f9', animation: 'pulse 1.5s infinite' }} />
          </div>
        </div>
        {[1, 2, 3].map(i => <div key={i} style={{ height: 80, borderRadius: 12, backgroundColor: '#f1f5f9', marginBottom: 16, animation: 'pulse 1.5s infinite' }} />)}
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      </div>
    );
  }

  const card: React.CSSProperties = { backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
  const sectionTitle: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 16, marginTop: 0 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#475569' };
  const btnPrimary: React.CSSProperties = { padding: '10px 22px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' };
  const btnSecondary: React.CSSProperties = { padding: '8px 16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, fontWeight: 500, color: '#475569', cursor: 'pointer' };
  const btnDanger: React.CSSProperties = { padding: '6px 14px', backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
  const badge = (enabled: boolean): React.CSSProperties => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, backgroundColor: enabled ? '#dcfce7' : '#f1f5f9', color: enabled ? '#16a34a' : '#64748b' });

  const toast = error || success || passwordError || passwordSuccess || mfaError || mfaSuccess || webhookError || webhookSuccess;
  const toastType = error || passwordError || mfaError || webhookError ? 'error' : 'success';
  const toastMsg = error || success || passwordError || passwordSuccess || mfaError || mfaSuccess || webhookError || webhookSuccess;

  const initials = profile.displayName ? profile.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '??';

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          padding: '12px 18px', borderRadius: 10, maxWidth: 360, fontSize: 13, fontWeight: 500,
          backgroundColor: toastType === 'error' ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${toastType === 'error' ? '#fecaca' : '#bbf7d0'}`,
          color: toastType === 'error' ? '#991b1b' : '#166534',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 999,
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 20, fontWeight: 700,
        }}>{initials}</div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>{profile.displayName || 'Your Profile'}</h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>{profile.email}</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, backgroundColor: '#f1f5f9', borderRadius: 10, padding: 4 }}>
        {(['profile', 'security', 'webhooks'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveProfileTab(tab)} style={{
            flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            backgroundColor: activeProfileTab === tab ? '#fff' : 'transparent',
            color: activeProfileTab === tab ? '#0f172a' : '#64748b',
            boxShadow: activeProfileTab === tab ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s', textTransform: 'capitalize',
          }}>{tab}</button>
        ))}
      </div>

      {/* PROFILE TAB */}
      {activeProfileTab === 'profile' && (
        <div style={card}>
          <h2 style={sectionTitle}>Profile Information</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Display Name</label>
              <input type="text" value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Timezone</label>
              <input type="text" value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} placeholder="e.g. Africa/Lagos" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleSaveProfile} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* SECURITY TAB */}
      {activeProfileTab === 'security' && (<>
        {/* Change Password */}
        <div style={card}>
          <h2 style={sectionTitle}>Change Password</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Current Password</label>
              <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={handleChangePassword} disabled={changingPassword} style={{ ...btnPrimary, opacity: changingPassword ? 0.6 : 1 }}>
                {changingPassword ? 'Changing...' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>

        {/* Two-Factor Authentication */}
        <div style={card}>
          <h2 style={sectionTitle}>Two-Factor Authentication</h2>
          {mfaStatus ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Authenticator App</span>
                  <span style={badge(mfaStatus.totpEnabled)}>{mfaStatus.totpEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                {mfaStatus.totpEnabled ? (
                  <button onClick={async () => { setMfaError(''); setMfaSuccess(''); try { await identityFetch('/v1/mfa/totp/disable', { method: 'POST' }); setMfaSuccess('TOTP disabled'); fetchMfaStatus(); setTotpSetup(null); } catch (err: unknown) { setMfaError(err instanceof Error ? err.message : 'Failed'); }}} style={btnDanger}>Disable</button>
                ) : (
                  <button onClick={async () => { setMfaError(''); setSettingUpTotp(true); try { const data = await identityFetch<TotpSetupResponse>('/v1/mfa/totp/setup', { method: 'POST' }); setTotpSetup(data); } catch (err: unknown) { setMfaError(err instanceof Error ? err.message : 'Failed'); } finally { setSettingUpTotp(false); }}} disabled={settingUpTotp} style={{ ...btnPrimary, fontSize: 13, padding: '8px 16px', opacity: settingUpTotp ? 0.6 : 1 }}>{settingUpTotp ? 'Setting up...' : 'Setup'}</button>
                )}
              </div>

              {totpSetup && !mfaStatus.totpEnabled && (
                <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginTop: 0, marginBottom: 12 }}>Setup Authenticator</h4>
                  <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>Scan this QR code with your authenticator app</p>
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={totpSetup.qrCodeDataUrl} alt="QR" style={{ width: 180, height: 180, borderRadius: 10, border: '1px solid #e2e8f0' }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Secret Key</label>
                    <code style={{ display: 'block', padding: '8px 12px', backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{totpSetup.secret}</code>
                  </div>
                  {totpSetup.recoveryCodes?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Recovery Codes</label>
                      <div style={{ padding: 10, backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'monospace', fontSize: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        {totpSetup.recoveryCodes.map((code, i) => <span key={i}>{code}</span>)}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Enter 6-digit code</label>
                      <input type="text" value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6} style={inputStyle} />
                    </div>
                    <button onClick={async () => { setMfaError(''); setVerifyingTotp(true); try { await identityFetch('/v1/mfa/totp/verify', { method: 'POST', body: JSON.stringify({ code: totpCode }) }); setMfaSuccess('Authenticator enabled!'); setTotpSetup(null); setTotpCode(''); fetchMfaStatus(); } catch (err: unknown) { setMfaError(err instanceof Error ? err.message : 'Invalid code'); } finally { setVerifyingTotp(false); }}} disabled={totpCode.length !== 6 || verifyingTotp} style={{ ...btnPrimary, fontSize: 13, padding: '10px 18px', opacity: totpCode.length !== 6 || verifyingTotp ? 0.5 : 1, whiteSpace: 'nowrap' }}>{verifyingTotp ? 'Verifying...' : 'Verify & Enable'}</button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: 10 }}>
                <div><span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Recovery Codes</span><span style={{ fontSize: 13, color: '#64748b', marginLeft: 8 }}>{mfaStatus.recoveryCodesRemaining} remaining</span></div>
                <button onClick={async () => { setMfaError(''); try { const data = await identityFetch<{ recoveryCodes: string[] }>('/v1/mfa/recovery-codes/regenerate', { method: 'POST' }); setMfaSuccess(`Codes regenerated: ${data.recoveryCodes.join(', ')}`); fetchMfaStatus(); } catch (err: unknown) { setMfaError(err instanceof Error ? err.message : 'Failed'); }}} style={btnSecondary}>Regenerate</button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Email OTP</span>
                  <span style={badge(mfaStatus.emailOtpEnabled)}>{mfaStatus.emailOtpEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <button onClick={async () => { setMfaError(''); try { await identityFetch('/v1/mfa/email/send', { method: 'POST' }); setMfaSuccess('Test OTP sent'); } catch (err: unknown) { setMfaError(err instanceof Error ? err.message : 'Failed'); }}} style={btnSecondary}>Send test</button>
              </div>
            </div>
          ) : (
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>Loading MFA status...</p>
          )}
        </div>
      </>)}

      {/* WEBHOOKS TAB */}
      {activeProfileTab === 'webhooks' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ ...sectionTitle, marginBottom: 0 }}>Webhook Endpoints</h2>
            {!showWebhookForm && (
              <button onClick={() => { setShowWebhookForm(true); setNewWebhookSecret(''); }} style={btnPrimary}>+ Add Webhook</button>
            )}
          </div>

          {showWebhookForm && (
            <div style={{ backgroundColor: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', padding: 20, marginBottom: 20 }}>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Webhook URL</label>
                <input type="url" value={newWebhookUrl} onChange={(e) => setNewWebhookUrl(e.target.value)} placeholder="https://example.com/webhook" style={inputStyle} />
              </div>
              {newWebhookSecret && (
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Webhook Secret (save this)</label>
                  <code style={{ display: 'block', padding: '10px 14px', backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{newWebhookSecret}</code>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowWebhookForm(false); setNewWebhookUrl(''); setNewWebhookSecret(''); }} style={btnSecondary}>Cancel</button>
                <button onClick={async () => { if (!newWebhookUrl.trim()) return; setWebhookError(''); setAddingWebhook(true); try { const data = await notificationFetch<Webhook>('/v1/webhooks', { method: 'POST', body: JSON.stringify({ url: newWebhookUrl }) }); if (data.secret) { setNewWebhookSecret(data.secret); setWebhookSuccess('Webhook created. Save the secret.'); } else { setWebhookSuccess('Webhook created'); setShowWebhookForm(false); setNewWebhookUrl(''); } fetchWebhooks(); } catch (err: unknown) { setWebhookError(err instanceof Error ? err.message : 'Failed'); } finally { setAddingWebhook(false); }}} disabled={addingWebhook || !newWebhookUrl.trim()} style={{ ...btnPrimary, opacity: addingWebhook || !newWebhookUrl.trim() ? 0.5 : 1 }}>{addingWebhook ? 'Adding...' : 'Add Webhook'}</button>
              </div>
            </div>
          )}

          {webhooks.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {webhooks.map((wh) => (
                <div key={wh.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                  <div>
                    <code style={{ fontSize: 13, color: '#0f172a', wordBreak: 'break-all' }}>{wh.url}</code>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                      <span style={badge(wh.active)}>{wh.active ? 'Active' : 'Inactive'}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>Created {new Date(wh.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button onClick={async () => { setWebhookError(''); try { await notificationFetch(`/v1/webhooks/${wh.id}`, { method: 'DELETE' }); setWebhookSuccess('Webhook deleted'); fetchWebhooks(); } catch (err: unknown) { setWebhookError(err instanceof Error ? err.message : 'Failed'); }}} style={btnDanger}>Delete</button>
                </div>
              ))}
            </div>
          ) : !showWebhookForm ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>{'\u{1F517}'}</div>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#334155', marginBottom: 4 }}>No webhooks configured</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Add a webhook to receive real-time notifications</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
