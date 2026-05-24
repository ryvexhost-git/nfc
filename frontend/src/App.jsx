import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const DEFAULT_CARD_ID = 'RYV-001';

const defaultSettings = {
  businessName: 'NFC-RYV',
  legalName: '',
  logoUrl: '',
  primaryColor: '#0f766e',
  supportPhone: '',
  supportEmail: '',
  websiteUrl: '',
  address: '',
  gstNumber: '',
  currencySymbol: 'Rs.',
  dailyDebitLimit: 50,
  lowBalanceThreshold: 50,
  maxCardBalance: 5000,
  openingBalanceDefault: 0,
  cardPrefix: 'RYV',
  nfcBaseUrl: '',
  invoicePrefix: 'NFC',
  timezone: 'Asia/Kolkata',
  receiptFooter: '',
  termsText: '',
  enableCustomerPhoto: true,
  requireExecutiveName: true,
};

function formatMoney(value, settings) {
  return `${settings.currencySymbol || 'Rs.'}${Number(value || 0).toFixed(0)}`;
}

function getPeriodStart(date, interval) {
  const period = new Date(date);
  period.setHours(0, 0, 0, 0);
  if (interval === 'week') {
    const day = period.getDay() || 7;
    period.setDate(period.getDate() - day + 1);
  }
  if (interval === 'month') {
    period.setDate(1);
  }
  return period;
}

function getPeriodKey(dateText, interval) {
  const period = getPeriodStart(new Date(dateText), interval);
  const year = period.getFullYear();
  const month = String(period.getMonth() + 1).padStart(2, '0');
  const day = String(period.getDate()).padStart(2, '0');
  if (interval === 'month') return `${year}-${month}`;
  if (interval === 'week') return `${year}-${month}-${day}`;
  return `${year}-${month}-${day}`;
}

function getPeriodLabel(key, interval) {
  const date = new Date(`${key}${interval === 'month' ? '-01' : ''}T00:00:00`);
  if (interval === 'month') {
    return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  if (interval === 'week') {
    const weekEnd = new Date(date);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return `${date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} - ${weekEnd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
  }
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function getAnalyticsRangeStart(range) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return start;
  if (range === 'thisWeek') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return start;
  }
  if (range === 'thisMonth') {
    start.setDate(1);
    return start;
  }
  if (range === 'last7') {
    start.setDate(start.getDate() - 6);
    return start;
  }
  if (range === 'last30') {
    start.setDate(start.getDate() - 29);
    return start;
  }
  if (range === 'last90') {
    start.setDate(start.getDate() - 89);
    return start;
  }
  return null;
}

function addPeriod(date, interval) {
  const next = new Date(date);
  if (interval === 'month') next.setMonth(next.getMonth() + 1);
  else if (interval === 'week') next.setDate(next.getDate() + 7);
  else next.setDate(next.getDate() + 1);
  return next;
}

function getPlaceholderPeriods(range, interval) {
  const end = getPeriodStart(new Date(), interval);
  let start = getAnalyticsRangeStart(range);
  if (!start) {
    start = new Date(end);
    if (interval === 'month') start.setMonth(start.getMonth() - 5);
    else if (interval === 'week') start.setDate(start.getDate() - 35);
    else start.setDate(start.getDate() - 6);
  }
  start = getPeriodStart(start, interval);

  const periods = [];
  let cursor = new Date(start);
  while (cursor <= end && periods.length < 120) {
    const key = getPeriodKey(cursor.toISOString(), interval);
    periods.push({ key, label: getPeriodLabel(key, interval), debit: 0, topup: 0, count: 0 });
    cursor = addPeriod(cursor, interval);
  }
  return periods;
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getCardIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryCard = params.get('card');
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const pathCard = pathParts[0] === 'admin' ? null : pathParts[0];
  return queryCard || pathCard || DEFAULT_CARD_ID;
}

function getAdminToken() {
  return localStorage.getItem('nfc_ryv_admin_token');
}

function getStaffToken() {
  return localStorage.getItem('nfc_ryv_staff_token');
}

function Brand({ settings }) {
  return (
    <div className="brand-lockup">
      {settings.logoUrl ? (
        <img className="brand-logo" src={settings.logoUrl} alt={settings.businessName} />
      ) : (
        <div className="brand-mark">{settings.businessName?.slice(0, 1) || 'N'}</div>
      )}
      <div>
        <span>NFC wallet</span>
        <h1>{settings.businessName}</h1>
      </div>
    </div>
  );
}

function CustomerApp({ settings, setSettings }) {
  const cardId = useMemo(() => getCardIdFromUrl(), []);
  const [token, setToken] = useState(null);
  const [card, setCard] = useState(null);
  const [password, setPassword] = useState('');
  const [amount, setAmount] = useState('');
  const [executiveName, setExecutiveName] = useState('');
  const [note, setNote] = useState('');
  const [debits, setDebits] = useState([]);
  const [topups, setTopups] = useState([]);
  const [debitedToday, setDebitedToday] = useState(0);
  const [remainingDailyLimit, setRemainingDailyLimit] = useState(settings.dailyDebitLimit);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [staffToken, setStaffToken] = useState(getStaffToken());
  const [staffUser, setStaffUser] = useState(null);
  const [staffLogin, setStaffLogin] = useState({ username: '', password: '' });
  const [staffPassword, setStaffPassword] = useState('');
  const [staffBusy, setStaffBusy] = useState(false);

  useEffect(() => {
    const loadCard = async () => {
      setLoading(true);
      try {
        localStorage.removeItem(`nfc_ryv_token_${cardId}`);
        const res = await fetch(`${API_BASE}/cards/${encodeURIComponent(cardId)}`);
        const data = await res.json();
        if (res.ok) {
          setCard(data.card);
          if (data.settings) setSettings(data.settings);
        } else {
          setCard(null);
          setMessage(data.error || 'Card not found');
        }
      } catch {
        setMessage('Unable to connect to the NFC server');
      } finally {
        setLoading(false);
      }
    };

    loadCard();
  }, [cardId, setSettings]);

  useEffect(() => {
    const loadStaffSession = async () => {
      if (!staffToken) {
        setStaffUser(null);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/admin/me`, {
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        const data = await res.json();
        if (res.ok) {
          setStaffUser(data.admin);
          return;
        }
      } catch {
        // Session is cleared below.
      }
      localStorage.removeItem('nfc_ryv_staff_token');
      setStaffToken(null);
      setStaffUser(null);
    };

    loadStaffSession();
  }, [staffToken]);

  const syncAccount = (data) => {
    setCard(data.card);
    setDebits(data.debits || []);
    setTopups(data.topups || []);
    setDebitedToday(Number(data.debitedToday || 0));
    setRemainingDailyLimit(Number(data.remainingDailyLimit || 0));
    if (data.settings) setSettings(data.settings);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Login failed');
        return;
      }

      setToken(data.token);
      syncAccount(data);
      setPassword('');
      setMessage('Card verified');
    } catch {
      setMessage('Unable to verify this card');
    } finally {
      setBusy(false);
    }
  };

  const handleDebit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const res = await fetch(`${API_BASE}/debit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: Number(amount), executiveName, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Debit failed');
        return;
      }

      syncAccount(data);
      setAmount('');
      setNote('');
      setMessage(`Debited ${formatMoney(data.transaction.amount, settings)} successfully`);
    } catch {
      setMessage('Unable to debit this card');
    } finally {
      setBusy(false);
    }
  };

  const handleLock = () => {
    setToken(null);
    setDebits([]);
    setTopups([]);
    setDebitedToday(0);
    setRemainingDailyLimit(card?.dailyLimit || settings.dailyDebitLimit);
  };

  const handleStaffLogin = async (event) => {
    event.preventDefault();
    setStaffBusy(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(staffLogin),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Staff login failed');
        return;
      }
      localStorage.setItem('nfc_ryv_staff_token', data.token);
      setStaffToken(data.token);
      setStaffUser(data.admin);
      setStaffLogin({ username: '', password: '' });
      setMessage('Staff session opened');
    } catch {
      setMessage('Unable to open staff session');
    } finally {
      setStaffBusy(false);
    }
  };

  const handleStaffPasswordReset = async (event) => {
    event.preventDefault();
    if (!staffPassword) {
      setMessage('Enter a new staff password');
      return;
    }
    setStaffBusy(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/admin/me/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ password: staffPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Password reset failed');
        return;
      }
      setStaffPassword('');
      setMessage('Staff password reset successfully');
    } catch {
      setMessage('Unable to reset staff password');
    } finally {
      setStaffBusy(false);
    }
  };

  const handleStaffLogout = () => {
    localStorage.removeItem('nfc_ryv_staff_token');
    setStaffToken(null);
    setStaffUser(null);
    setStaffPassword('');
    setMessage('Staff session closed');
  };

  if (loading) {
    return (
      <main className="app-screen">
        <section className="app-shell compact-shell loading-shell">Loading card...</section>
      </main>
    );
  }

  const cardStyle = {
    background: `linear-gradient(135deg, #102827 0%, ${settings.primaryColor || '#0f766e'} 58%, #d97706 130%)`,
  };

  return (
    <main className="app-screen">
      <section className="app-shell compact-shell">
        <Brand settings={settings} />

        {card ? (
          <>
            <section className="card-panel" style={cardStyle}>
              <div>
                <span className="label">Card Holder</span>
                <h2>{card.holderName}</h2>
                {card.position && <span className="position-badge">{card.position}</span>}
              </div>
              {settings.enableCustomerPhoto !== false && card.photoUrl ? (
                <img className="customer-photo" src={card.photoUrl} alt={card.holderName} />
              ) : settings.enableCustomerPhoto !== false ? (
                <div className="customer-photo placeholder-photo">{card.holderName?.slice(0, 1) || 'C'}</div>
              ) : null}
              <span className={`status-pill ${card.status}`}>{card.status}</span>
            </section>

            {!token ? (
              <form className="form-panel" onSubmit={handleLogin}>
                <div className="notice-box">Enter the card password to view balance and debit from this card.</div>
                <label>
                  Card password
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter password" required />
                </label>
                <button type="submit" disabled={busy}>{busy ? 'Verifying...' : 'Open Card'}</button>
              </form>
            ) : (
              <>
                <section className="balance-grid">
                  <div>
                    <span>Available Balance</span>
                    <strong>{formatMoney(card.balance, settings)}</strong>
                  </div>
                  <div>
                    <span>Left Today</span>
                    <strong>{formatMoney(remainingDailyLimit, settings)}</strong>
                  </div>
                  <div>
                    <span>Used Today</span>
                    <strong>{formatMoney(debitedToday, settings)}</strong>
                  </div>
                </section>

                <form className="form-panel" onSubmit={handleDebit}>
                  <label>
                    Executive name
                    <input type="text" value={executiveName} onChange={(event) => setExecutiveName(event.target.value)} placeholder="Counter executive" required={settings.requireExecutiveName !== false} />
                  </label>
                  <label>
                    Debit amount
                    <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} min="1" max={settings.dailyDebitLimit} placeholder={`Maximum ${formatMoney(settings.dailyDebitLimit, settings)} per day`} required />
                  </label>
                  <label>
                    Note
                    <input type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Purpose" />
                  </label>
                  <button type="submit" disabled={busy || remainingDailyLimit <= 0}>{busy ? 'Processing...' : 'Debit Card'}</button>
                </form>

                <section className="history-panel">
                  <div className="history-head">
                    <h3>Recent Debits</h3>
                    <button type="button" onClick={handleLock}>Lock</button>
                  </div>
                  {debits.length === 0 ? (
                    <p>No debits yet.</p>
                  ) : (
                    <div className="transaction-list">
                      {debits.map((transaction) => (
                        <article key={transaction.id} className="transaction-row">
                          <div>
                            <strong>{formatMoney(transaction.amount, settings)}</strong>
                            <span>{transaction.note || transaction.actor || 'Counter debit'}</span>
                          </div>
                          <time>{new Date(transaction.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section className="history-panel">
                  <div className="history-head">
                    <h3>Top-up Details</h3>
                  </div>
                  {topups.length === 0 ? (
                    <p>No top-ups yet.</p>
                  ) : (
                    <div className="transaction-list">
                      {topups.map((transaction) => (
                        <article key={transaction.id} className="transaction-row topup-row">
                          <div>
                            <strong>{formatMoney(transaction.amount, settings)}</strong>
                            <span>{transaction.note || transaction.actor || 'Balance top-up'}</span>
                          </div>
                          <time>{new Date(transaction.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        ) : (
          <section className="card-panel missing-card" style={cardStyle}>
            <div>
              <span className="label">NFC Card</span>
              <h2>Card not found</h2>
              <p>Please contact the counter team to verify this card.</p>
            </div>
          </section>
        )}

        <section className="staff-session-panel">
          <div className="history-head">
            <div>
              <h3>Admin / Manager Session</h3>
              <p className="muted">Staff login is only for resetting your own password from this NFC app.</p>
            </div>
            {staffUser && <button type="button" onClick={handleStaffLogout}>Logout</button>}
          </div>
          {!staffUser ? (
            <form className="form-panel staff-session-form" onSubmit={handleStaffLogin}>
              <label>
                Username
                <input value={staffLogin.username} onChange={(event) => setStaffLogin({ ...staffLogin, username: event.target.value })} placeholder="admin or manager username" required />
              </label>
              <label>
                Password
                <input type="password" value={staffLogin.password} onChange={(event) => setStaffLogin({ ...staffLogin, password: event.target.value })} placeholder="Staff password" required />
              </label>
              <button type="submit" disabled={staffBusy}>{staffBusy ? 'Opening...' : 'Login'}</button>
            </form>
          ) : (
            <form className="form-panel staff-session-form" onSubmit={handleStaffPasswordReset}>
              <div className="notice-box">Logged in as {staffUser.name || staffUser.username} ({staffUser.role}). Only password reset is available here.</div>
              <label>
                New password
                <input type="password" value={staffPassword} onChange={(event) => setStaffPassword(event.target.value)} placeholder="Enter new password" required />
              </label>
              <button type="submit" disabled={staffBusy}>{staffBusy ? 'Resetting...' : 'Reset Password'}</button>
            </form>
          )}
        </section>

        {(settings.supportPhone || settings.supportEmail) && (
          <footer className="support-footer">
            {settings.supportPhone && <span>{settings.supportPhone}</span>}
            {settings.supportEmail && <span>{settings.supportEmail}</span>}
            {settings.websiteUrl && <span>{settings.websiteUrl}</span>}
          </footer>
        )}

        {(settings.termsText || settings.receiptFooter) && (
          <div className="customer-note">
            {settings.termsText && <p>{settings.termsText}</p>}
            {settings.receiptFooter && <p>{settings.receiptFooter}</p>}
          </div>
        )}

        {message && <p className="message-box">{message}</p>}
      </section>
    </main>
  );
}

function AdminApp({ settings, setSettings }) {
  const [token, setToken] = useState(getAdminToken());
  const [login, setLogin] = useState({ username: 'admin', password: '' });
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [activeAdminPage, setActiveAdminPage] = useState('overview');
  const [cards, setCards] = useState([]);
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [nextCardNumber, setNextCardNumber] = useState('');
  const [activeCardId, setActiveCardId] = useState('');
  const [message, setMessage] = useState('');
  const [cardForm, setCardForm] = useState({ cardNumber: '', holderName: '', phone: '', position: '', photoUrl: '', password: '', balance: 0, status: 'active' });
  const [topUpForm, setTopUpForm] = useState({ cardId: '', amount: '', note: '' });
  const [userForm, setUserForm] = useState({ username: '', name: '', password: '', role: 'manager' });
  const [accountPassword, setAccountPassword] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [cardStatusFilter, setCardStatusFilter] = useState('all');
  const [transactionSearch, setTransactionSearch] = useState('');
  const [analyticsCardId, setAnalyticsCardId] = useState('all');
  const [analyticsInterval, setAnalyticsInterval] = useState('day');
  const [analyticsRange, setAnalyticsRange] = useState('last30');
  const [analyticsChartType, setAnalyticsChartType] = useState('bar');

  const adminHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    if (token) {
      loadAdminData();
    }
  }, [token]);

  const apiJson = async (url, options = {}) => {
    const res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...adminHeaders,
        ...(options.headers || {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const loadAdminData = async () => {
    try {
      const [meData, settingsData, cardsData, txData] = await Promise.all([
        apiJson('/admin/me'),
        apiJson('/admin/settings'),
        apiJson('/admin/cards'),
        apiJson('/admin/transactions'),
      ]);
      const usersData = meData.admin?.role === 'admin' ? await apiJson('/admin/users') : { users: [{ ...meData.admin, active: true }] };
      setCurrentAdmin(meData.admin);
      setSettings(settingsData.settings);
      setCards(cardsData.cards);
      setTransactions(txData.transactions);
      setUsers(usersData.users);
      setNextCardNumber(cardsData.nextCardNumber);
      setCardForm((prev) => ({ ...prev, cardNumber: prev.cardNumber || cardsData.nextCardNumber }));
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handleAdminLogin = async (event) => {
    event.preventDefault();
    try {
      const data = await apiJson('/admin/login', {
        method: 'POST',
        body: JSON.stringify(login),
      });
      localStorage.setItem('nfc_ryv_admin_token', data.token);
      setToken(data.token);
      setCurrentAdmin(data.admin);
      setSettings(data.settings);
      setMessage('Admin signed in');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    try {
      const data = await apiJson('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(data.settings);
      if (data.nextCardNumber) {
        setNextCardNumber(data.nextCardNumber);
        setCardForm((prev) => ({ ...prev, cardNumber: data.nextCardNumber }));
      }
      setMessage('Business settings saved');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const createCard = async (event) => {
    event.preventDefault();
    try {
      const data = await apiJson('/admin/cards', {
        method: 'POST',
        body: JSON.stringify(cardForm),
      });
      setCards((prev) => [...prev, data.card].sort((a, b) => a.cardNumber.localeCompare(b.cardNumber)));
      setNextCardNumber(data.nextCardNumber);
      setCardForm({ cardNumber: data.nextCardNumber, holderName: '', phone: '', position: '', photoUrl: '', password: '', balance: 0, status: 'active' });
      await loadAdminData();
      setMessage('Card created');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const updateCard = async (card, patch) => {
    try {
      const data = await apiJson(`/admin/cards/${card.id}`, {
        method: 'PUT',
        body: JSON.stringify({ holderName: card.holderName, phone: card.phone, position: card.position, photoUrl: card.photoUrl, status: card.status, ...patch }),
      });
      setCards((prev) => prev.map((item) => (item.id === data.card.id ? data.card : item)));
      setMessage('Card updated');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handlePhotoUpload = async (event, callback) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('Please choose an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage('Photo must be below 2 MB');
      event.target.value = '';
      return;
    }
    try {
      const photoUrl = await readImageAsDataUrl(file);
      callback(photoUrl);
    } catch {
      setMessage('Unable to read selected photo');
    }
  };

  const topUpCard = async (event) => {
    event.preventDefault();
    if (!topUpForm.cardId) {
      setMessage('Choose a card to top up');
      return;
    }
    const selectedCard = cards.find((card) => card.id === topUpForm.cardId);
    const nextBalance = Number(selectedCard?.balance || 0) + Number(topUpForm.amount || 0);
    if (Number(settings.maxCardBalance || 0) > 0 && nextBalance > Number(settings.maxCardBalance)) {
      setMessage(`Maximum card balance is ${formatMoney(settings.maxCardBalance, settings)}`);
      return;
    }
    try {
      await apiJson(`/admin/cards/${topUpForm.cardId}/topup`, {
        method: 'POST',
        body: JSON.stringify(topUpForm),
      });
      setTopUpForm({ cardId: '', amount: '', note: '' });
      await loadAdminData();
      setMessage('Balance topped up');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const createUser = async (event) => {
    event.preventDefault();
    try {
      const data = await apiJson('/admin/users', {
        method: 'POST',
        body: JSON.stringify(userForm),
      });
      setUsers((prev) => [...prev, data.user]);
      setUserForm({ username: '', name: '', password: '', role: 'manager' });
      setMessage('Manager user created');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const resetOwnPassword = async (event) => {
    event.preventDefault();
    if (!accountPassword) {
      setMessage('Enter a new password');
      return;
    }
    try {
      await apiJson('/admin/me/password', {
        method: 'PUT',
        body: JSON.stringify({ password: accountPassword }),
      });
      setAccountPassword('');
      setShowAccountMenu(false);
      setMessage('Password reset successfully');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const deleteUser = async (userId) => {
    try {
      await apiJson(`/admin/users/${userId}`, { method: 'DELETE' });
      setUsers((prev) => prev.map((user) => (user.id === userId ? { ...user, active: false } : user)));
      setMessage('User disabled');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const deleteCard = async (cardId) => {
    try {
      await apiJson(`/admin/cards/${cardId}`, { method: 'DELETE' });
      setCards((prev) => prev.filter((card) => card.id !== cardId));
      setMessage('Card user deleted');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const exportTransactions = () => {
    window.open(`${API_BASE}/admin/transactions/export?token=${encodeURIComponent(token)}`, '_blank');
  };

  const copyCardLink = async (cardNumber) => {
    const baseUrl = String(settings.nfcBaseUrl || window.location.origin).replace(/\/$/, '');
    const link = `${baseUrl}/${cardNumber}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage('NFC card link copied');
    } catch {
      setMessage(link);
    }
  };

  const sendLowBalanceMessage = (card) => {
    const phoneDigits = String(card.phone || '').replace(/\D/g, '');
    if (!phoneDigits) {
      setMessage('No phone number saved for this card');
      return;
    }
    const whatsappPhone = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;
    const businessName = settings.businessName || 'NFC Wallet';
    const messageText = `Hi ${card.holderName}, your ${businessName} NFC card ${card.cardNumber} balance is ${formatMoney(card.balance, settings)}. Please top up to continue using it.`;
    window.open(`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(messageText)}`, '_blank', 'noopener,noreferrer');
    setMessage('Low-balance message opened');
  };

  const logout = () => {
    localStorage.removeItem('nfc_ryv_admin_token');
    setToken(null);
    setCurrentAdmin(null);
    setShowAccountMenu(false);
  };

  const adminPages = [
    { id: 'overview', label: 'Overview', group: 'Dashboard' },
    { id: 'business', label: 'Business Settings', group: 'Dashboard' },
    { id: 'cards', label: 'Cards', group: 'Wallet' },
    { id: 'topups', label: 'Top-ups', group: 'Wallet' },
    { id: 'transactions', label: 'Transactions', group: 'Reports' },
    { id: 'analytics', label: 'Analytics', group: 'Reports' },
    ...(currentAdmin?.role === 'admin' ? [{ id: 'users', label: 'Employees', group: 'Team' }] : []),
  ];
  const adminNavGroups = adminPages.reduce((groups, page) => {
    const group = groups.find((item) => item.label === page.group);
    if (group) group.pages.push(page);
    else groups.push({ label: page.group, pages: [page] });
    return groups;
  }, []);

  const cardLookup = useMemo(() => {
    return cards.reduce((lookup, card) => {
      lookup[card.id] = card;
      lookup[card.cardNumber] = card;
      return lookup;
    }, {});
  }, [cards]);
  const recentDebits = transactions.filter((transaction) => transaction.type === 'debit').slice(0, 12);
  const recentTopups = transactions.filter((transaction) => transaction.type === 'topup').slice(0, 12);
  const messageBalanceLimit = 100;
  const lowBalanceCards = cards.filter((card) => card.status === 'active' && Number(card.balance || 0) < messageBalanceLimit);
  const filteredCards = cards.filter((card) => {
    const search = cardSearch.trim().toLowerCase();
    const matchesSearch = !search
      || card.cardNumber.toLowerCase().includes(search)
      || card.holderName.toLowerCase().includes(search)
      || String(card.phone || '').includes(search)
      || String(card.position || '').toLowerCase().includes(search);
    const matchesStatus = cardStatusFilter === 'all' || card.status === cardStatusFilter;
    return matchesSearch && matchesStatus;
  });
  const matchesTransactionSearch = (transaction) => {
    const search = transactionSearch.trim().toLowerCase();
    return !search
      || String(transaction.card_number || '').toLowerCase().includes(search)
      || String(transaction.note || '').toLowerCase().includes(search)
      || String(transaction.actor || '').toLowerCase().includes(search);
  };
  const filteredDebits = recentDebits.filter(matchesTransactionSearch);
  const filteredTopups = recentTopups.filter(matchesTransactionSearch);
  const analyticsRangeStart = getAnalyticsRangeStart(analyticsRange);
  const analyticsTransactions = transactions.filter((transaction) => {
    const matchesCard = analyticsCardId === 'all' || transaction.card_id === analyticsCardId || transaction.card_number === analyticsCardId;
    const matchesRange = !analyticsRangeStart || new Date(transaction.created_at) >= analyticsRangeStart;
    return matchesCard && matchesRange;
  });
  const analyticsGroups = analyticsTransactions
    .reduce((groups, transaction) => {
      const key = getPeriodKey(transaction.created_at, analyticsInterval);
      const current = groups[key] || { key, label: getPeriodLabel(key, analyticsInterval), debit: 0, topup: 0, count: 0 };
      current[transaction.type] = Number(current[transaction.type] || 0) + Number(transaction.amount || 0);
      current.count += 1;
      groups[key] = current;
      return groups;
    }, {});
  const analyticsData = getPlaceholderPeriods(analyticsRange, analyticsInterval)
    .map((period) => ({ ...period, ...(analyticsGroups[period.key] || {}) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const analyticsMax = Math.max(1, ...analyticsData.map((item) => Math.max(item.debit, item.topup)));
  const analyticsTotals = analyticsTransactions.reduce((totals, transaction) => {
    totals[transaction.type] = Number(totals[transaction.type] || 0) + Number(transaction.amount || 0);
    return totals;
  }, { debit: 0, topup: 0 });
  const analyticsCard = analyticsCardId === 'all' ? null : cardLookup[analyticsCardId];
  const analyticsChartWidth = Math.max(680, analyticsData.length * 86);
  const analyticsLineHeight = 230;
  const analyticsLinePoints = (type) => analyticsData.map((item, index) => {
    const x = analyticsData.length <= 1 ? analyticsChartWidth / 2 : (index / (analyticsData.length - 1)) * (analyticsChartWidth - 64) + 32;
    const y = analyticsLineHeight - 30 - (Number(item[type] || 0) / analyticsMax) * 170;
    return `${x},${y}`;
  }).join(' ');
  const analyticsPieTotal = Number(analyticsTotals.debit || 0) + Number(analyticsTotals.topup || 0);
  const analyticsDebitPercent = analyticsPieTotal ? Math.round((Number(analyticsTotals.debit || 0) / analyticsPieTotal) * 100) : 0;

  if (!token) {
    return (
      <main className="admin-screen">
        <section className="login-card">
          <Brand settings={settings} />
          <form className="form-panel" onSubmit={handleAdminLogin}>
            <label>
              Admin username
              <input value={login.username} onChange={(event) => setLogin({ ...login, username: event.target.value })} required />
            </label>
            <label>
              Admin password
              <input type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="Default: admin123" required />
            </label>
            <button type="submit">Sign In</button>
          </form>
          {message && <p className="message-box">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-screen">
      <section className="admin-shell">
        <aside className="admin-sidebar">
          <Brand settings={settings} />
          <nav className="admin-nav" aria-label="Admin sections">
            {adminNavGroups.map((group) => (
              <div className="admin-nav-group" key={group.label}>
                <span>{group.label}</span>
                {group.pages.map((page) => (
                  <button
                    key={page.id}
                    className={activeAdminPage === page.id ? 'active' : ''}
                    type="button"
                    onClick={() => setActiveAdminPage(page.id)}
                  >
                    {page.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="page-kicker">NFC Admin</span>
            <h2>{adminPages.find((page) => page.id === activeAdminPage)?.label || 'Dashboard'}</h2>
          </div>
          <div className="topbar-actions">
            <a className="ghost-button" href="/" target="_blank">Open card app</a>
            <div className="account-menu">
              <button className="ghost-button account-trigger" type="button" onClick={() => setShowAccountMenu((value) => !value)}>
                {currentAdmin?.name || currentAdmin?.username || 'Admin'}
              </button>
              {showAccountMenu && (
                <div className="account-popover">
                  <form onSubmit={resetOwnPassword}>
                    <label>
                      Reset password
                      <input type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="New password" required />
                    </label>
                    <button type="submit">Reset Password</button>
                  </form>
                  <button className="logout-option" type="button" onClick={logout}>Logout</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {activeAdminPage === 'overview' && (
          <>
            <section className="stats-grid">
              <div><span>Total Cards</span><strong>{cards.length}</strong></div>
              <div><span>Active Cards</span><strong>{cards.filter((card) => card.status === 'active').length}</strong></div>
              <div><span>Total Balance</span><strong>{formatMoney(cards.reduce((sum, card) => sum + Number(card.balance), 0), settings)}</strong></div>
              <div><span>Low Balance</span><strong>{lowBalanceCards.length}</strong></div>
            </section>

            <div className="admin-grid">
              <section className="panel">
                <div className="panel-head">
                  <h2>Business Profile</h2>
                  <button type="button" onClick={() => setActiveAdminPage('business')}>Edit</button>
                </div>
                <div className="detail-list">
                  <div><span>Business</span><strong>{settings.businessName || 'Not set'}</strong></div>
                  <div><span>Card prefix</span><strong>{settings.cardPrefix || 'RYV'}</strong></div>
                  <div><span>Daily debit limit</span><strong>{formatMoney(settings.dailyDebitLimit, settings)}</strong></div>
                  <div><span>Transactions</span><strong>{transactions.length}</strong></div>
                  <div><span>Support</span><strong>{settings.supportPhone || settings.supportEmail || 'Not set'}</strong></div>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2>Quick Actions</h2>
                </div>
                <div className="quick-actions">
                  <button type="button" onClick={() => setActiveAdminPage('cards')}>Create Card</button>
                  <button type="button" onClick={() => setActiveAdminPage('topups')}>Top Up Balance</button>
                  <button type="button" onClick={() => setActiveAdminPage('transactions')}>Export Report</button>
                </div>
              </section>
            </div>

            <section className="panel">
              <div className="panel-head">
                <h2>Recent Activity</h2>
                <button type="button" onClick={() => setActiveAdminPage('transactions')}>View All</button>
              </div>
              <div className="transaction-list dashboard-transactions">
                {transactions.slice(0, 8).length === 0 ? (
                  <p className="muted">No transactions yet.</p>
                ) : transactions.slice(0, 8).map((transaction) => (
                  <article key={transaction.id} className="transaction-row">
                    <div>
                      <strong>{transaction.card_number} - {transaction.type}</strong>
                      <span>{transaction.note || transaction.actor}</span>
                    </div>
                    <div className="amount-stack">
                      <b>{formatMoney(transaction.amount, settings)}</b>
                      <time>{new Date(transaction.created_at).toLocaleString('en-IN')}</time>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {activeAdminPage === 'business' && (
          <form className="panel standard-page advanced-settings" onSubmit={saveSettings}>
            <div className="panel-head">
              <div>
                <h2>Business Settings</h2>
                <p className="muted">Manage brand identity, wallet rules, NFC defaults, and report details.</p>
              </div>
              <button type="submit">Save</button>
            </div>

            <section className="settings-section">
              <h3>Brand & Public Profile</h3>
              <div className="field-grid">
                <label>Business name<input value={settings.businessName} onChange={(event) => setSettings({ ...settings, businessName: event.target.value })} placeholder="Your business name" /></label>
                <label>Legal name<input value={settings.legalName} onChange={(event) => setSettings({ ...settings, legalName: event.target.value })} placeholder="Registered legal name" /></label>
                <label>Logo URL<input value={settings.logoUrl} onChange={(event) => setSettings({ ...settings, logoUrl: event.target.value })} placeholder="https://example.com/logo.png" /></label>
                <label>Primary color<input type="color" value={settings.primaryColor} onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })} /></label>
                <label>Website URL<input value={settings.websiteUrl} onChange={(event) => setSettings({ ...settings, websiteUrl: event.target.value })} placeholder="https://yourbusiness.com" /></label>
                <label>GST / Tax ID<input value={settings.gstNumber} onChange={(event) => setSettings({ ...settings, gstNumber: event.target.value.toUpperCase() })} placeholder="GSTIN or tax number" /></label>
                <label>Support phone<input value={settings.supportPhone} onChange={(event) => setSettings({ ...settings, supportPhone: event.target.value })} placeholder="Business phone number" /></label>
                <label>Support email<input value={settings.supportEmail} onChange={(event) => setSettings({ ...settings, supportEmail: event.target.value })} placeholder="support@example.com" /></label>
                <label className="wide-field">Address<textarea value={settings.address} onChange={(event) => setSettings({ ...settings, address: event.target.value })} placeholder="Business address" rows="3" /></label>
              </div>
            </section>

            <section className="settings-section">
              <h3>Wallet Rules</h3>
              <div className="field-grid">
                <label>Currency symbol<input value={settings.currencySymbol} onChange={(event) => setSettings({ ...settings, currencySymbol: event.target.value })} placeholder="Rs." /></label>
                <label>Daily debit limit<input type="number" value={settings.dailyDebitLimit} onChange={(event) => setSettings({ ...settings, dailyDebitLimit: Number(event.target.value) })} placeholder="50" /></label>
                <label>Low balance alert<input type="number" value={settings.lowBalanceThreshold} onChange={(event) => setSettings({ ...settings, lowBalanceThreshold: Number(event.target.value) })} placeholder="50" /></label>
                <label>Maximum card balance<input type="number" value={settings.maxCardBalance} onChange={(event) => setSettings({ ...settings, maxCardBalance: Number(event.target.value) })} placeholder="5000" /></label>
                <label>Default opening balance<input type="number" value={settings.openingBalanceDefault} onChange={(event) => setSettings({ ...settings, openingBalanceDefault: Number(event.target.value) })} placeholder="0" /></label>
                <label>Timezone<input value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} placeholder="Asia/Kolkata" /></label>
              </div>
            </section>

            <section className="settings-section">
              <h3>NFC & Card Defaults</h3>
              <div className="field-grid">
                <label>Card prefix<input value={settings.cardPrefix} onChange={(event) => setSettings({ ...settings, cardPrefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="RYV" /></label>
                <label>NFC base URL<input value={settings.nfcBaseUrl} onChange={(event) => setSettings({ ...settings, nfcBaseUrl: event.target.value })} placeholder="https://nfc.domain.com" /></label>
                <label>Invoice prefix<input value={settings.invoicePrefix} onChange={(event) => setSettings({ ...settings, invoicePrefix: event.target.value.toUpperCase() })} placeholder="NFC" /></label>
                <label className="toggle-row"><input type="checkbox" checked={settings.enableCustomerPhoto !== false} onChange={(event) => setSettings({ ...settings, enableCustomerPhoto: event.target.checked })} /> Enable customer photo</label>
                <label className="toggle-row"><input type="checkbox" checked={settings.requireExecutiveName !== false} onChange={(event) => setSettings({ ...settings, requireExecutiveName: event.target.checked })} /> Require executive name</label>
              </div>
            </section>

            <section className="settings-section">
              <h3>Receipts & Customer Notes</h3>
              <div className="field-grid">
                <label className="wide-field">Receipt footer<textarea value={settings.receiptFooter} onChange={(event) => setSettings({ ...settings, receiptFooter: event.target.value })} placeholder="Thank you for visiting." rows="3" /></label>
                <label className="wide-field">Terms / customer note<textarea value={settings.termsText} onChange={(event) => setSettings({ ...settings, termsText: event.target.value })} placeholder="Balance is usable only at this business." rows="3" /></label>
              </div>
            </section>

            <div className="settings-summary">
              <span>Next card number: <strong>{nextCardNumber || `${settings.cardPrefix || 'RYV'}-001`}</strong></span>
              <span>Low balance below: <strong>{formatMoney(settings.lowBalanceThreshold, settings)}</strong></span>
            </div>
          </form>
        )}

        {activeAdminPage === 'cards' && (
          <>
            <form className="panel standard-page" onSubmit={createCard}>
              <div className="panel-head">
                <div>
                  <h2>Create Card</h2>
                  <p className="muted">Use the generated card number or enter one manually for a mapped NFC card.</p>
                </div>
                <button type="submit">Create</button>
              </div>
              <div className="field-grid">
                <label>Card number<input value={cardForm.cardNumber || nextCardNumber} onChange={(event) => setCardForm({ ...cardForm, cardNumber: event.target.value })} placeholder={nextCardNumber} /></label>
                <label>Holder name<input value={cardForm.holderName} onChange={(event) => setCardForm({ ...cardForm, holderName: event.target.value })} placeholder="Customer full name" required /></label>
                <label>Phone<input value={cardForm.phone} onChange={(event) => setCardForm({ ...cardForm, phone: event.target.value })} placeholder="Customer mobile number" /></label>
                <label>Position<input value={cardForm.position} onChange={(event) => setCardForm({ ...cardForm, position: event.target.value })} placeholder="Premium Customer" /></label>
                {settings.enableCustomerPhoto !== false && <label>Customer photo<input type="file" accept="image/*" onChange={(event) => handlePhotoUpload(event, (photoUrl) => setCardForm((prev) => ({ ...prev, photoUrl })))} /></label>}
                <label>Password<input value={cardForm.password} onChange={(event) => setCardForm({ ...cardForm, password: event.target.value })} placeholder="Card login password" required /></label>
                <label>Opening balance<input type="number" value={cardForm.balance} onChange={(event) => setCardForm({ ...cardForm, balance: Number(event.target.value) })} placeholder="0" /></label>
                <label>Status<select value={cardForm.status} onChange={(event) => setCardForm({ ...cardForm, status: event.target.value })}><option>active</option><option>blocked</option></select></label>
                {settings.enableCustomerPhoto !== false && cardForm.photoUrl && (
                  <div className="photo-preview">
                    <img src={cardForm.photoUrl} alt="Customer preview" />
                    <button type="button" onClick={() => setCardForm((prev) => ({ ...prev, photoUrl: '' }))}>Remove Photo</button>
                  </div>
                )}
              </div>
            </form>

            <section className="panel">
              <div className="panel-head">
                <h2>Card List</h2>
                <span className="muted">{filteredCards.length} of {cards.length} cards shown.</span>
              </div>
              <div className="filter-bar">
                <input value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="Search card, holder, phone, or position" />
                <select value={cardStatusFilter} onChange={(event) => setCardStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="blocked">Blocked</option>
                  <option value="deleted">Deleted</option>
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Photo</th><th>Card</th><th>Holder</th><th>Phone</th><th>Position</th><th>Balance</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {filteredCards.map((card) => (
                      <tr key={card.id} className={activeCardId === card.id ? 'selected-row' : ''} onClick={() => { setActiveCardId(card.id); setTopUpForm((prev) => ({ ...prev, cardId: card.id })); }}>
                        <td>
                          {settings.enableCustomerPhoto !== false ? (
                            <div className="table-photo-cell">
                              {card.photoUrl ? (
                                <img className="table-photo" src={card.photoUrl} alt={card.holderName} />
                              ) : (
                                <div className="table-photo placeholder-photo">{card.holderName?.slice(0, 1) || 'C'}</div>
                              )}
                              <label className="photo-upload-button">
                                Upload
                                <input
                                  type="file"
                                  accept="image/*"
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    event.stopPropagation();
                                    handlePhotoUpload(event, (photoUrl) => updateCard(card, { photoUrl }));
                                  }}
                                />
                              </label>
                              {card.photoUrl && (
                                <button className="table-button" type="button" onClick={(event) => { event.stopPropagation(); updateCard(card, { photoUrl: '' }); }}>
                                  Remove
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="muted">Off</span>
                          )}
                        </td>
                        <td>{card.cardNumber}</td>
                        <td>{card.holderName}</td>
                        <td>{card.phone}</td>
                        <td>
                          <input
                            className="inline-input"
                            defaultValue={card.position || ''}
                            onClick={(event) => event.stopPropagation()}
                            onBlur={(event) => {
                              const nextPosition = event.target.value.trim();
                              if (nextPosition !== (card.position || '')) updateCard(card, { position: nextPosition });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                            }}
                            placeholder="Position"
                          />
                        </td>
                        <td>
                          <span className="balance-cell-value">{formatMoney(card.balance, settings)}</span>
                          {card.status === 'active' && Number(card.balance || 0) < messageBalanceLimit && <span className="balance-alert">Low</span>}
                        </td>
                        <td><span className={`small-status ${card.status}`}>{card.status}</span></td>
                        <td>
                          {card.status === 'active' && Number(card.balance || 0) < messageBalanceLimit && (
                            <button className="table-button warning-button" type="button" onClick={(event) => { event.stopPropagation(); sendLowBalanceMessage(card); }}>
                              Message
                            </button>
                          )}
                          <button className="table-button" type="button" onClick={(event) => { event.stopPropagation(); copyCardLink(card.cardNumber); }}>
                            Copy Link
                          </button>
                          <button className="table-button" type="button" onClick={(event) => { event.stopPropagation(); updateCard(card, { status: card.status === 'active' ? 'blocked' : 'active' }); }}>
                            {card.status === 'active' ? 'Block' : 'Activate'}
                          </button>
                          <button className="table-button danger-button" type="button" onClick={(event) => { event.stopPropagation(); deleteCard(card.id); }}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredCards.length === 0 && <p className="muted empty-state">No cards match this filter.</p>}
              </div>
            </section>
          </>
        )}

        {activeAdminPage === 'topups' && (
          <div className="admin-grid">
            <form className="panel" onSubmit={topUpCard}>
              <div className="panel-head">
                <div>
                  <h2>Balance Top-up</h2>
                  <p className="muted">Add balance to an existing NFC card.</p>
                </div>
                <button type="submit">Top Up</button>
              </div>
              <div className="field-grid">
                <label>Card<select value={topUpForm.cardId} onChange={(event) => setTopUpForm({ ...topUpForm, cardId: event.target.value })}><option value="">Select card</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.cardNumber} - {card.holderName}</option>)}</select></label>
                <label>Amount<input type="number" value={topUpForm.amount} onChange={(event) => setTopUpForm({ ...topUpForm, amount: event.target.value })} placeholder="100" /></label>
                <label className="wide-field">Note<input value={topUpForm.note} onChange={(event) => setTopUpForm({ ...topUpForm, note: event.target.value })} placeholder="Cash reload, UPI reload..." /></label>
              </div>
            </form>

            <section className="panel">
              <div className="panel-head">
                <h2>Top-up Details</h2>
              </div>
              <div className="filter-bar compact-filter">
                <input value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} placeholder="Search card, note, or staff" />
              </div>
              <div className="transaction-list dashboard-transactions">
                {filteredTopups.length === 0 ? (
                  <p className="muted">No top-ups yet.</p>
                ) : filteredTopups.map((transaction) => (
                  <article key={transaction.id} className="transaction-row topup-row">
                    <div>
                      <strong>{transaction.card_number}</strong>
                      <span>{transaction.note || transaction.actor || 'Balance top-up'}</span>
                    </div>
                    <div className="amount-stack">
                      <b>{formatMoney(transaction.amount, settings)}</b>
                      <time>{new Date(transaction.created_at).toLocaleString('en-IN')}</time>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeAdminPage === 'transactions' && (
          <>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Debit Transactions</h2>
                  <p className="muted">Top-ups are shown separately in the Top-ups page.</p>
                </div>
                <button type="button" onClick={exportTransactions}>Export CSV</button>
              </div>
              <div className="filter-bar compact-filter">
                <input value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} placeholder="Search card, note, or staff" />
              </div>
              <div className="transaction-list dashboard-transactions">
                {filteredDebits.length === 0 ? (
                  <p className="muted">No debits yet.</p>
                ) : filteredDebits.map((transaction) => (
                  <article key={transaction.id} className="transaction-row">
                    <div>
                      <strong>{transaction.card_number}</strong>
                      <span>{transaction.note || transaction.actor || 'Counter debit'}</span>
                    </div>
                    <div className="amount-stack">
                      <b>{formatMoney(transaction.amount, settings)}</b>
                      <time>{new Date(transaction.created_at).toLocaleString('en-IN')}</time>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {activeAdminPage === 'analytics' && (
          <>
            <section className="panel standard-page">
              <div className="panel-head">
                <div>
                  <h2>Customer Amount Analytics</h2>
                  <p className="muted">Automatically uses debit and top-up data from the other tabs. Select a range and grouping to view the graph.</p>
                </div>
              </div>
              <div className="filter-bar analytics-controls">
                <label>
                  Customer
                  <select value={analyticsCardId} onChange={(event) => setAnalyticsCardId(event.target.value)}>
                    <option value="all">All customers</option>
                    {cards.map((card) => (
                      <option key={card.id} value={card.id}>{card.cardNumber} - {card.holderName}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Range
                  <select value={analyticsRange} onChange={(event) => setAnalyticsRange(event.target.value)}>
                    <option value="today">Today</option>
                    <option value="thisWeek">This week</option>
                    <option value="thisMonth">This month</option>
                    <option value="last7">Last 7 days</option>
                    <option value="last30">Last 30 days</option>
                    <option value="last90">Last 90 days</option>
                    <option value="all">All time</option>
                  </select>
                </label>
                <label>
                  Group by
                  <select value={analyticsInterval} onChange={(event) => setAnalyticsInterval(event.target.value)}>
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </label>
                <label>
                  Chart type
                  <select value={analyticsChartType} onChange={(event) => setAnalyticsChartType(event.target.value)}>
                    <option value="bar">Bar chart</option>
                    <option value="line">Line diagram</option>
                    <option value="pie">Pie diagram</option>
                  </select>
                </label>
              </div>
              <div className="analytics-summary">
                <div><span>Customer</span><strong>{analyticsCard ? analyticsCard.holderName : 'All customers'}</strong></div>
                <div><span>Total debited</span><strong>{formatMoney(analyticsTotals.debit, settings)}</strong></div>
                <div><span>Total topped up</span><strong>{formatMoney(analyticsTotals.topup, settings)}</strong></div>
                <div><span>Entries</span><strong>{analyticsTransactions.length}</strong></div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Amount by Date</h2>
                  <p className="muted">Orange shows debits. Green shows top-ups.</p>
                </div>
              </div>
              {analyticsChartType === 'bar' && (
                <div className="chart-scroll">
                  <div className="amount-chart" style={{ minWidth: `${analyticsChartWidth}px` }}>
                    {analyticsData.map((item) => (
                      <div className="chart-column" key={item.key}>
                        <div className="chart-bars">
                          <span
                            className="chart-bar debit-bar"
                            style={{ height: item.debit ? `${Math.max(6, (item.debit / analyticsMax) * 170)}px` : 0 }}
                            title={`Debit ${formatMoney(item.debit, settings)}`}
                          />
                          <span
                            className="chart-bar topup-bar"
                            style={{ height: item.topup ? `${Math.max(6, (item.topup / analyticsMax) * 170)}px` : 0 }}
                            title={`Top-up ${formatMoney(item.topup, settings)}`}
                          />
                        </div>
                        <strong>{item.label}</strong>
                        <span>{formatMoney(item.debit, settings)} debit</span>
                        <span>{formatMoney(item.topup, settings)} top-up</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {analyticsChartType === 'line' && (
                <div className="chart-scroll">
                  <div className="line-chart" style={{ minWidth: `${analyticsChartWidth}px` }}>
                    <svg viewBox={`0 0 ${analyticsChartWidth} ${analyticsLineHeight}`} role="img" aria-label="Debit and top-up line diagram">
                      <line className="chart-axis" x1="32" y1={analyticsLineHeight - 30} x2={analyticsChartWidth - 32} y2={analyticsLineHeight - 30} />
                      <line className="chart-axis" x1="32" y1="24" x2="32" y2={analyticsLineHeight - 30} />
                      <polyline className="line-path debit-line" points={analyticsLinePoints('debit')} />
                      <polyline className="line-path topup-line" points={analyticsLinePoints('topup')} />
                      {analyticsData.map((item, index) => {
                        const x = analyticsData.length <= 1 ? analyticsChartWidth / 2 : (index / (analyticsData.length - 1)) * (analyticsChartWidth - 64) + 32;
                        return (
                          <g key={item.key}>
                            <circle className="line-point debit-point" cx={x} cy={analyticsLineHeight - 30 - (Number(item.debit || 0) / analyticsMax) * 170} r="4" />
                            <circle className="line-point topup-point" cx={x} cy={analyticsLineHeight - 30 - (Number(item.topup || 0) / analyticsMax) * 170} r="4" />
                            {index % Math.max(1, Math.ceil(analyticsData.length / 8)) === 0 && <text className="line-label" x={x} y={analyticsLineHeight - 8}>{item.label}</text>}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              )}
              {analyticsChartType === 'pie' && (
                <div className="pie-chart-wrap">
                  <div
                    className="pie-chart"
                    style={{
                      background: analyticsPieTotal
                        ? `conic-gradient(#f97316 0 ${analyticsDebitPercent}%, #0f766e ${analyticsDebitPercent}% 100%)`
                        : 'conic-gradient(#e5e7eb 0 100%)',
                    }}
                    role="img"
                    aria-label="Debit and top-up pie diagram"
                  >
                    <div>
                      <strong>{analyticsPieTotal ? `${analyticsDebitPercent}%` : '0%'}</strong>
                      <span>Debit share</span>
                    </div>
                  </div>
                  <div className="pie-legend">
                    <div><span className="legend-dot debit-dot" />Debit {formatMoney(analyticsTotals.debit, settings)}</div>
                    <div><span className="legend-dot topup-dot" />Top-up {formatMoney(analyticsTotals.topup, settings)}</div>
                  </div>
                </div>
              )}
              {analyticsTransactions.length === 0 && <p className="muted chart-note">No transactions in this range yet. The timeline is ready and will fill automatically.</p>}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Detailed Entries</h2>
                <span className="muted">{analyticsTransactions.length} transactions</span>
              </div>
              <div className="transaction-list dashboard-transactions">
                {analyticsTransactions.length === 0 ? (
                  <p className="muted">No dated amounts to show.</p>
                ) : analyticsTransactions.map((transaction) => {
                  const transactionCard = cardLookup[transaction.card_id] || cardLookup[transaction.card_number];
                  return (
                    <article key={transaction.id} className={`transaction-row ${transaction.type === 'topup' ? 'topup-row' : ''}`}>
                      <div>
                        <strong>{transactionCard?.holderName || transaction.card_number}</strong>
                        <span>{transaction.card_number} - {transaction.note || transaction.actor || transaction.type}</span>
                      </div>
                      <div className="amount-stack">
                        <b>{formatMoney(transaction.amount, settings)}</b>
                        <time>{new Date(transaction.created_at).toLocaleString('en-IN')}</time>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {activeAdminPage === 'users' && currentAdmin?.role === 'admin' && (
          <>
            <form className="panel employee-window" onSubmit={createUser}>
              <div className="panel-head">
                <div>
                  <h2>Create Employee Login</h2>
                  <p className="muted">Create full-size staff login profiles for admins and managers.</p>
                </div>
                <button type="submit">Create Employee</button>
              </div>
              <div className="field-grid">
                <label>Username<input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} placeholder="manager01" required /></label>
                <label>Name<input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} placeholder="Staff name" required /></label>
                <label>Password<input value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} placeholder="Temporary password" required /></label>
                <label>Role<select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}><option value="manager">manager</option><option value="admin">admin</option></select></label>
              </div>
            </form>

            <section className="panel">
              <div className="panel-head">
                <h2>Admin & Manager Users</h2>
                <span className="muted">Disable old manager logins.</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>{user.username}</td>
                        <td>{user.name}</td>
                        <td>{user.role}</td>
                        <td><span className={`small-status ${user.active ? 'active' : 'blocked'}`}>{user.active ? 'active' : 'disabled'}</span></td>
                        <td>
                          <button className="table-button danger-button" type="button" disabled={!user.active || user.username === 'admin'} onClick={() => deleteUser(user.id)}>Disable</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {message && <p className="message-box floating-message">{message}</p>}
        </section>
      </section>
    </main>
  );
}

function App() {
  const [settings, setSettings] = useState(defaultSettings);
  const isAdmin = window.location.pathname.startsWith('/admin');

  useEffect(() => {
    fetch(`${API_BASE}/settings/public`)
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) setSettings(data.settings);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--primary', settings.primaryColor || '#0f766e');
  }, [settings.primaryColor]);

  return isAdmin ? (
    <AdminApp settings={settings} setSettings={setSettings} />
  ) : (
    <CustomerApp settings={settings} setSettings={setSettings} />
  );
}

export default App;
