import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const DEFAULT_CARD_ID = 'RYV-001';

const defaultSettings = {
  businessName: 'NFC-RYV',
  logoUrl: '',
  primaryColor: '#0f766e',
  supportPhone: '',
  supportEmail: '',
  address: '',
  currencySymbol: 'Rs.',
  dailyDebitLimit: 50,
  cardPrefix: 'RYV',
};

function formatMoney(value, settings) {
  return `${settings.currencySymbol || 'Rs.'}${Number(value || 0).toFixed(0)}`;
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

function getStoredToken(cardId) {
  return localStorage.getItem(`nfc_ryv_token_${cardId}`);
}

function getAdminToken() {
  return localStorage.getItem('nfc_ryv_admin_token');
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
  const [token, setToken] = useState(() => getStoredToken(cardId));
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

  useEffect(() => {
    const loadCard = async () => {
      setLoading(true);
      try {
        if (token) {
          const res = await fetch(`${API_BASE}/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (res.ok) {
            syncAccount(data);
            return;
          }
          localStorage.removeItem(`nfc_ryv_token_${cardId}`);
          setToken(null);
        }

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
  }, [cardId, token, setSettings]);

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

      localStorage.setItem(`nfc_ryv_token_${cardId}`, data.token);
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
    localStorage.removeItem(`nfc_ryv_token_${cardId}`);
    setToken(null);
    setDebits([]);
    setTopups([]);
    setDebitedToday(0);
    setRemainingDailyLimit(card?.dailyLimit || settings.dailyDebitLimit);
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
                <p>{card.cardNumber}</p>
                {card.position && <span className="position-badge">{card.position}</span>}
              </div>
              {card.photoUrl ? (
                <img className="customer-photo" src={card.photoUrl} alt={card.holderName} />
              ) : (
                <div className="customer-photo placeholder-photo">{card.holderName?.slice(0, 1) || 'C'}</div>
              )}
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
                    <input type="text" value={executiveName} onChange={(event) => setExecutiveName(event.target.value)} placeholder="Counter executive" />
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
              <p>Use a URL like /{settings.cardPrefix}-001 or /?card={settings.cardPrefix}-001.</p>
            </div>
          </section>
        )}

        {(settings.supportPhone || settings.supportEmail) && (
          <footer className="support-footer">
            {settings.supportPhone && <span>{settings.supportPhone}</span>}
            {settings.supportEmail && <span>{settings.supportEmail}</span>}
          </footer>
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
    const link = `${window.location.origin}/${cardNumber}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage('NFC card link copied');
    } catch {
      setMessage(link);
    }
  };

  const logout = () => {
    localStorage.removeItem('nfc_ryv_admin_token');
    setToken(null);
    setCurrentAdmin(null);
    setShowAccountMenu(false);
  };

  const adminPages = [
    { id: 'overview', label: 'Overview' },
    { id: 'business', label: 'Business' },
    { id: 'cards', label: 'Cards' },
    { id: 'topups', label: 'Top-ups' },
    { id: 'transactions', label: 'Transactions' },
    ...(currentAdmin?.role === 'admin' ? [{ id: 'users', label: 'Users' }] : []),
  ];

  const recentDebits = transactions.filter((transaction) => transaction.type === 'debit').slice(0, 12);
  const recentTopups = transactions.filter((transaction) => transaction.type === 'topup').slice(0, 12);
  const lowBalanceCards = cards.filter((card) => card.status === 'active' && Number(card.balance || 0) < Number(settings.dailyDebitLimit || 50));
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
        <header className="admin-topbar">
          <Brand settings={settings} />
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

        <nav className="admin-nav" aria-label="Admin sections">
          {adminPages.map((page) => (
            <button
              key={page.id}
              className={activeAdminPage === page.id ? 'active' : ''}
              type="button"
              onClick={() => setActiveAdminPage(page.id)}
            >
              {page.label}
            </button>
          ))}
        </nav>

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
          <form className="panel standard-page" onSubmit={saveSettings}>
            <div className="panel-head">
              <div>
                <h2>Business Settings</h2>
                <p className="muted">These details appear on the customer card app and admin records.</p>
              </div>
              <button type="submit">Save</button>
            </div>
            <div className="field-grid">
              <label>Business name<input value={settings.businessName} onChange={(event) => setSettings({ ...settings, businessName: event.target.value })} placeholder="Your business name" /></label>
              <label>Logo URL<input value={settings.logoUrl} onChange={(event) => setSettings({ ...settings, logoUrl: event.target.value })} placeholder="https://example.com/logo.png" /></label>
              <label>Primary color<input type="color" value={settings.primaryColor} onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })} /></label>
              <label>Currency symbol<input value={settings.currencySymbol} onChange={(event) => setSettings({ ...settings, currencySymbol: event.target.value })} placeholder="Rs." /></label>
              <label>Daily debit limit<input type="number" value={settings.dailyDebitLimit} onChange={(event) => setSettings({ ...settings, dailyDebitLimit: Number(event.target.value) })} placeholder="50" /></label>
              <label>Card prefix<input value={settings.cardPrefix} onChange={(event) => setSettings({ ...settings, cardPrefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="RYV" /></label>
              <label>Support phone<input value={settings.supportPhone} onChange={(event) => setSettings({ ...settings, supportPhone: event.target.value })} placeholder="Business phone number" /></label>
              <label>Support email<input value={settings.supportEmail} onChange={(event) => setSettings({ ...settings, supportEmail: event.target.value })} placeholder="support@example.com" /></label>
              <label className="wide-field">Address<input value={settings.address} onChange={(event) => setSettings({ ...settings, address: event.target.value })} placeholder="Business address" /></label>
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
                <label>Customer photo<input type="file" accept="image/*" onChange={(event) => handlePhotoUpload(event, (photoUrl) => setCardForm((prev) => ({ ...prev, photoUrl })))} /></label>
                <label>Password<input value={cardForm.password} onChange={(event) => setCardForm({ ...cardForm, password: event.target.value })} placeholder="Card login password" required /></label>
                <label>Opening balance<input type="number" value={cardForm.balance} onChange={(event) => setCardForm({ ...cardForm, balance: Number(event.target.value) })} placeholder="0" /></label>
                <label>Status<select value={cardForm.status} onChange={(event) => setCardForm({ ...cardForm, status: event.target.value })}><option>active</option><option>blocked</option></select></label>
                {cardForm.photoUrl && (
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
                        <td>{formatMoney(card.balance, settings)}</td>
                        <td><span className={`small-status ${card.status}`}>{card.status}</span></td>
                        <td>
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

        {activeAdminPage === 'users' && currentAdmin?.role === 'admin' && (
          <>
            <form className="panel standard-page" onSubmit={createUser}>
              <div className="panel-head">
                <div>
                  <h2>Create Admin or Manager</h2>
                  <p className="muted">Create staff logins for operating the NFC wallet system.</p>
                </div>
                <button type="submit">Create</button>
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
