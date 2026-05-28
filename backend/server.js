import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || 'nfc-ryv-dev-secret-change-me';
const DEFAULT_DAILY_LIMIT = Number(process.env.DAILY_DEBIT_LIMIT || 50);
const SESSION_EXPIRES_IN = '10m';
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  credentials: true,
}));
app.use(express.json({ limit: '6mb' }));

const defaultSettings = {
  businessName: 'NFC-RYV',
  legalName: '',
  logoUrl: '',
  primaryColor: '#0f766e',
  supportPhone: '9999999999',
  supportEmail: 'support@example.com',
  websiteUrl: '',
  address: 'Business address',
  gstNumber: '',
  currencySymbol: 'Rs.',
  dailyDebitLimit: DEFAULT_DAILY_LIMIT,
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

const defaultAdmin = {
  id: 'admin-001',
  username: 'admin',
  password_hash: '$2b$10$qGvk71lNwuwEplB8GRTXQO1u32XdG0neTxnW20S4SD4EYzUf7spkO',
  name: 'Administrator',
  role: 'admin',
  created_at: '2026-05-22T00:00:00.000Z',
};

const defaultManager = {
  id: 'manager-001',
  username: 'manager',
  password_hash: '$2b$10$YtnbVGvibR1PGS.3lhkfEehjQZe8ICBMIxka/44G4oqggJVZu9o/i',
  name: 'Default Manager',
  role: 'manager',
  active: true,
  created_at: '2026-05-22T00:00:00.000Z',
};

function ensureDb() {
  const dataDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      settings: defaultSettings,
      admins: [defaultAdmin, defaultManager],
      cards: [],
      transactions: [],
    }, null, 2));
  }
}

function normalizeDb(data) {
  const admins = data.admins?.length ? data.admins : [defaultAdmin, defaultManager];
  const hasDefaultManager = admins.some((admin) => admin.username === defaultManager.username);
  return {
    settings: { ...defaultSettings, ...(data.settings || {}) },
    admins: (hasDefaultManager ? admins : [...admins, defaultManager]).map((admin) => ({
      active: true,
      ...admin,
    })),
    cards: data.cards || [],
    transactions: data.transactions || [],
  };
}

function readDb() {
  ensureDb();
  return normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(normalizeDb(data), null, 2));
}

function todayKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function getDailyLimit(db) {
  return Number(db.settings.dailyDebitLimit || DEFAULT_DAILY_LIMIT);
}

function normalizeCardPrefix(value) {
  const prefix = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return prefix || defaultSettings.cardPrefix;
}

function getCardById(db, cardId) {
  return db.cards.find((card) => card.id === cardId || card.card_number === cardId);
}

function getPublicSettings(settings) {
  return {
    businessName: settings.businessName,
    legalName: settings.legalName,
    logoUrl: settings.logoUrl,
    primaryColor: settings.primaryColor,
    supportPhone: settings.supportPhone,
    supportEmail: settings.supportEmail,
    websiteUrl: settings.websiteUrl,
    address: settings.address,
    gstNumber: settings.gstNumber,
    currencySymbol: settings.currencySymbol,
    dailyDebitLimit: Number(settings.dailyDebitLimit),
    lowBalanceThreshold: Number(settings.lowBalanceThreshold),
    maxCardBalance: Number(settings.maxCardBalance),
    openingBalanceDefault: Number(settings.openingBalanceDefault),
    cardPrefix: settings.cardPrefix,
    nfcBaseUrl: settings.nfcBaseUrl,
    invoicePrefix: settings.invoicePrefix,
    timezone: settings.timezone,
    receiptFooter: settings.receiptFooter,
    termsText: settings.termsText,
    enableCustomerPhoto: settings.enableCustomerPhoto !== false,
    requireExecutiveName: settings.requireExecutiveName !== false,
  };
}

function getPublicCard(card, db) {
  return {
    id: card.id,
    cardNumber: card.card_number,
    holderName: card.holder_name,
    phone: card.phone,
    position: card.position || '',
    photoUrl: card.photo_url || '',
    status: card.status,
    balance: Number(card.balance || 0),
    dailyLimit: getDailyLimit(db),
    createdAt: card.created_at,
    updatedAt: card.updated_at,
  };
}

function getCardToken(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.scope === 'nfc-card' ? payload : null;
  } catch {
    return null;
  }
}

function getAdminToken(req) {
  const authHeader = req.headers.authorization;
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.scope === 'admin' ? payload : null;
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const session = getAdminToken(req);
  if (!session) return res.status(401).json({ error: 'Admin login required' });
  req.admin = session;
  next();
}

function requireOwnerAdmin(req, res, next) {
  if (req.admin?.role !== 'admin') {
    return res.status(403).json({ error: 'Only an admin can manage staff users' });
  }
  next();
}

function getCardTransactions(db, cardId) {
  return db.transactions.filter((transaction) => transaction.card_id === cardId);
}

function getCardSummary(db, card) {
  const today = todayKey();
  const dailyLimit = getDailyLimit(db);
  const transactions = getCardTransactions(db, card.id);
  const debits = transactions.filter((transaction) => transaction.type === 'debit');
  const topups = transactions.filter((transaction) => transaction.type === 'topup');
  const debitedToday = transactions
    .filter((transaction) => transaction.type === 'debit' && transaction.created_at.startsWith(today))
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

  return {
    card: getPublicCard(card, db),
    settings: getPublicSettings(db.settings),
    debitedToday,
    remainingDailyLimit: Math.max(0, dailyLimit - debitedToday),
    debits: debits.slice(-10).reverse(),
    topups: topups.slice(-10).reverse(),
    transactions: transactions.slice(-10).reverse(),
  };
}

function getNextCardNumber(db) {
  const prefix = normalizeCardPrefix(db.settings.cardPrefix);
  const existingNumbers = db.cards
    .map((card) => card.card_number)
    .filter((cardNumber) => cardNumber.startsWith(`${prefix}-`))
    .map((cardNumber) => Number(cardNumber.replace(`${prefix}-`, '')))
    .filter(Number.isFinite);
  const nextNumber = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
}

function createTransaction({ card, amount, type, note, actor }) {
  return {
    id: uuidv4(),
    card_id: card.id,
    card_number: card.card_number,
    type,
    amount: Number(amount),
    balance_after: Number(card.balance),
    actor: actor || 'System',
    note: note || '',
    created_at: new Date().toISOString(),
  };
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'nfc-ryv-backend' });
});

app.get('/api/settings/public', (req, res) => {
  const db = readDb();
  res.json({ settings: getPublicSettings(db.settings) });
});

app.get('/api/cards/:cardId', (req, res) => {
  const db = readDb();
  const card = getCardById(db, req.params.cardId);

  if (!card) return res.status(404).json({ error: 'Card not found' });

  res.json({
    card: {
      id: card.id,
      cardNumber: card.card_number,
      holderName: card.holder_name,
      phone: card.phone,
      position: card.position || '',
      photoUrl: card.photo_url || '',
      status: card.status,
      dailyLimit: getDailyLimit(db),
    },
    settings: getPublicSettings(db.settings),
  });
});

app.post('/api/login', async (req, res) => {
  const { cardId, password } = req.body;
  const db = readDb();
  const card = getCardById(db, cardId);

  if (!card || card.status !== 'active') return res.status(404).json({ error: 'Active card not found' });

  const validPassword = await bcrypt.compare(password || '', card.password_hash);
  if (!validPassword) return res.status(401).json({ error: 'Invalid card password' });

  const token = jwt.sign(
    { scope: 'nfc-card', cardId: card.id, cardNumber: card.card_number },
    JWT_SECRET,
    { expiresIn: SESSION_EXPIRES_IN }
  );

  res.json({ token, ...getCardSummary(db, card) });
});

app.get('/api/me', (req, res) => {
  const session = getCardToken(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const db = readDb();
  const card = getCardById(db, session.cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  res.json(getCardSummary(db, card));
});

app.post('/api/debit', (req, res) => {
  const session = getCardToken(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount' });

  const db = readDb();
  const dailyLimit = getDailyLimit(db);

  if (amount > dailyLimit) {
    return res.status(400).json({ error: `A single debit cannot be more than ${db.settings.currencySymbol}${dailyLimit}` });
  }

  const card = getCardById(db, session.cardId);
  if (!card || card.status !== 'active') return res.status(404).json({ error: 'Active card not found' });

  const today = todayKey();
  const debitedToday = db.transactions
    .filter((transaction) => transaction.card_id === card.id && transaction.type === 'debit' && transaction.created_at.startsWith(today))
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

  if (debitedToday + amount > dailyLimit) {
    return res.status(400).json({
      error: `Daily debit limit is ${db.settings.currencySymbol}${dailyLimit}. Remaining today: ${db.settings.currencySymbol}${Math.max(0, dailyLimit - debitedToday)}`,
    });
  }

  if (Number(card.balance) < amount) {
    return res.status(400).json({ error: `Insufficient balance. Available: ${db.settings.currencySymbol}${Number(card.balance)}` });
  }

  card.balance = Number(card.balance) - amount;
  card.updated_at = new Date().toISOString();
  const transaction = createTransaction({
    card,
    amount,
    type: 'debit',
    note: req.body.note,
    actor: req.body.executiveName || 'Counter Executive',
  });

  db.transactions.push(transaction);
  writeDb(db);

  res.status(201).json({ transaction, ...getCardSummary(db, card) });
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const db = readDb();
  const admin = db.admins.find((item) => item.active !== false && item.username.toLowerCase() === String(username || '').toLowerCase());

  if (!admin || !(await bcrypt.compare(password || '', admin.password_hash))) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const token = jwt.sign(
    { scope: 'admin', adminId: admin.id, username: admin.username, name: admin.name, role: admin.role },
    JWT_SECRET,
    { expiresIn: SESSION_EXPIRES_IN }
  );

  res.json({
    token,
    admin: { id: admin.id, username: admin.username, name: admin.name, role: admin.role },
    settings: getPublicSettings(db.settings),
  });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  const db = readDb();
  const admin = db.admins.find((item) => item.id === req.admin.adminId);
  res.json({
    admin: { id: admin?.id, username: admin?.username, name: admin?.name, role: admin?.role },
    settings: getPublicSettings(db.settings),
  });
});

app.put('/api/admin/me/password', requireAdmin, async (req, res) => {
  const db = readDb();
  const admin = db.admins.find((item) => item.id === req.admin.adminId);
  if (!admin) return res.status(404).json({ error: 'Admin user not found' });
  if (!req.body.password) return res.status(400).json({ error: 'New password is required' });

  admin.password_hash = await bcrypt.hash(req.body.password, 10);
  admin.updated_at = new Date().toISOString();
  writeDb(db);

  res.json({ success: true });
});

app.get('/api/admin/users', requireAdmin, requireOwnerAdmin, (req, res) => {
  const db = readDb();
  const users = db.admins.map((admin) => ({
    id: admin.id,
    username: admin.username,
    name: admin.name,
    role: admin.role,
    active: admin.active !== false,
    createdAt: admin.created_at,
  }));
  res.json({ users });
});

app.post('/api/admin/users', requireAdmin, requireOwnerAdmin, async (req, res) => {
  const db = readDb();
  const { username, name, password, role } = req.body;

  if (!username || !name || !password) {
    return res.status(400).json({ error: 'Username, name, and password are required' });
  }

  if (!['admin', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or manager' });
  }

  if (db.admins.some((admin) => admin.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const user = {
    id: uuidv4(),
    username,
    name,
    role,
    active: true,
    password_hash: await bcrypt.hash(password, 10),
    created_at: new Date().toISOString(),
  };

  db.admins.push(user);
  writeDb(db);

  res.status(201).json({
    user: { id: user.id, username: user.username, name: user.name, role: user.role, active: user.active, createdAt: user.created_at },
  });
});

app.put('/api/admin/users/:userId/password', requireAdmin, requireOwnerAdmin, async (req, res) => {
  const db = readDb();
  const user = db.admins.find((admin) => admin.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!req.body.password) return res.status(400).json({ error: 'New password is required' });

  user.password_hash = await bcrypt.hash(req.body.password, 10);
  user.updated_at = new Date().toISOString();
  writeDb(db);

  res.json({ success: true });
});

app.delete('/api/admin/users/:userId', requireAdmin, requireOwnerAdmin, (req, res) => {
  const db = readDb();
  const user = db.admins.find((admin) => admin.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.admin.adminId) return res.status(400).json({ error: 'You cannot delete your own login' });
  if (user.username === 'admin') return res.status(400).json({ error: 'Default admin cannot be deleted' });

  user.active = false;
  user.updated_at = new Date().toISOString();
  writeDb(db);

  res.json({ success: true });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ settings: getPublicSettings(db.settings) });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const db = readDb();
  const nextSettings = {
    ...db.settings,
    businessName: req.body.businessName || db.settings.businessName,
    legalName: req.body.legalName || '',
    logoUrl: req.body.logoUrl || '',
    primaryColor: req.body.primaryColor || db.settings.primaryColor,
    supportPhone: req.body.supportPhone || '',
    supportEmail: req.body.supportEmail || '',
    websiteUrl: req.body.websiteUrl || '',
    address: req.body.address || '',
    gstNumber: req.body.gstNumber || '',
    currencySymbol: req.body.currencySymbol || db.settings.currencySymbol,
    dailyDebitLimit: Number(req.body.dailyDebitLimit || db.settings.dailyDebitLimit),
    lowBalanceThreshold: Number(req.body.lowBalanceThreshold || db.settings.lowBalanceThreshold || 50),
    maxCardBalance: Number(req.body.maxCardBalance || db.settings.maxCardBalance || 5000),
    openingBalanceDefault: Number(req.body.openingBalanceDefault || 0),
    cardPrefix: normalizeCardPrefix(req.body.cardPrefix || db.settings.cardPrefix),
    nfcBaseUrl: req.body.nfcBaseUrl || '',
    invoicePrefix: req.body.invoicePrefix || db.settings.invoicePrefix || 'NFC',
    timezone: req.body.timezone || db.settings.timezone || 'Asia/Kolkata',
    receiptFooter: req.body.receiptFooter || '',
    termsText: req.body.termsText || '',
    enableCustomerPhoto: req.body.enableCustomerPhoto !== false,
    requireExecutiveName: req.body.requireExecutiveName !== false,
  };

  db.settings = nextSettings;
  writeDb(db);
  res.json({ settings: getPublicSettings(nextSettings), nextCardNumber: getNextCardNumber(db) });
});

app.get('/api/admin/cards', requireAdmin, (req, res) => {
  const db = readDb();
  const search = String(req.query.search || '').toLowerCase();
  const cards = db.cards
    .filter((card) => !search
      || card.card_number.toLowerCase().includes(search)
      || card.holder_name.toLowerCase().includes(search)
      || String(card.phone || '').includes(search))
    .map((card) => getPublicCard(card, db))
    .sort((a, b) => a.cardNumber.localeCompare(b.cardNumber));

  res.json({ cards, nextCardNumber: getNextCardNumber(db) });
});

app.post('/api/admin/cards', requireAdmin, async (req, res) => {
  const db = readDb();
  const cardNumber = String(req.body.cardNumber || getNextCardNumber(db)).trim().toUpperCase();
  const holderName = String(req.body.holderName || '').trim();
  const password = String(req.body.password || '').trim();

  if (!holderName || !password) {
    return res.status(400).json({ error: 'Holder name and password are required' });
  }

  if (db.cards.some((card) => String(card.card_number || '').toUpperCase() === cardNumber)) {
    return res.status(409).json({ error: 'Card number already exists' });
  }

  const now = new Date().toISOString();
  const card = {
    id: uuidv4(),
    card_number: cardNumber,
    holder_name: holderName,
    phone: String(req.body.phone || '').trim(),
    position: String(req.body.position || '').trim(),
    photo_url: String(req.body.photoUrl || '').trim(),
    password_hash: await bcrypt.hash(password, 10),
    balance: Number(req.body.balance || 0),
    status: req.body.status || 'active',
    created_at: now,
    updated_at: now,
  };

  db.cards.push(card);

  if (Number(card.balance) > 0) {
    db.transactions.push(createTransaction({
      card,
      amount: Number(card.balance),
      type: 'topup',
      note: 'Opening balance',
      actor: req.admin.name,
    }));
  }

  writeDb(db);
  res.status(201).json({ card: getPublicCard(card, db), nextCardNumber: getNextCardNumber(db) });
});

app.put('/api/admin/cards/:cardId', requireAdmin, async (req, res) => {
  const db = readDb();
  const card = getCardById(db, req.params.cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  card.holder_name = req.body.holderName || card.holder_name;
  card.phone = req.body.phone ?? card.phone;
  if (Object.prototype.hasOwnProperty.call(req.body, 'position')) {
    card.position = String(req.body.position || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'photoUrl')) {
    card.photo_url = String(req.body.photoUrl || '').trim();
  }
  card.status = req.body.status || card.status;
  card.updated_at = new Date().toISOString();

  if (Object.prototype.hasOwnProperty.call(req.body, 'password')) {
    const nextPassword = String(req.body.password || '').trim();
    if (!nextPassword) return res.status(400).json({ error: 'New card PIN is required' });
    card.password_hash = await bcrypt.hash(nextPassword, 10);
  }

  writeDb(db);
  res.json({ card: getPublicCard(card, db) });
});

app.delete('/api/admin/cards/:cardId', requireAdmin, (req, res) => {
  const db = readDb();
  const card = getCardById(db, req.params.cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  card.status = 'deleted';
  card.deleted_at = new Date().toISOString();
  card.updated_at = card.deleted_at;
  writeDb(db);

  res.json({ success: true });
});

app.post('/api/admin/cards/:cardId/topup', requireAdmin, (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid top-up amount' });

  const db = readDb();
  const card = getCardById(db, req.params.cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  card.balance = Number(card.balance) + amount;
  card.updated_at = new Date().toISOString();
  const transaction = createTransaction({
    card,
    amount,
    type: 'topup',
    note: req.body.note || 'Balance top-up',
    actor: req.admin.name,
  });

  db.transactions.push(transaction);
  writeDb(db);

  res.status(201).json({ card: getPublicCard(card, db), transaction });
});

app.get('/api/admin/transactions', requireAdmin, (req, res) => {
  const db = readDb();
  const cardId = req.query.cardId;
  const transactions = db.transactions
    .filter((transaction) => !cardId || transaction.card_id === cardId || transaction.card_number === cardId)
    .slice()
    .reverse();

  res.json({ transactions });
});

app.get('/api/admin/transactions/export', requireAdmin, (req, res) => {
  const db = readDb();
  const rows = [
    ['Date', 'Card Number', 'Type', 'Amount', 'Balance After', 'Actor', 'Note'],
    ...db.transactions.slice().reverse().map((transaction) => [
      transaction.created_at,
      transaction.card_number,
      transaction.type,
      transaction.amount,
      transaction.balance_after,
      transaction.actor,
      transaction.note,
    ]),
  ];
  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(`nfc-transactions-${todayKey()}.csv`);
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`NFC-RYV backend running on port ${PORT}`);
});
