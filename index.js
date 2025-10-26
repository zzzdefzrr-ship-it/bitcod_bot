/**
Bitcod Bot - Node.js (polling)
Features:
- Command-based bot for workers
- Show balance, request withdrawal (manual)
- Admin receives withdrawal requests and can mark as paid
- Simple JSON 'database' (data.json)
Language: Arabic (MSA)
*/
import fs from 'fs';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

dotenv.config();

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!TOKEN) {
  console.error("Please set TELEGRAM_TOKEN in .env");
  process.exit(1);
}
if (!ADMIN_ID) {
  console.error("Please set ADMIN_ID in .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const DATA_FILE = './data.json';

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { users: {}, withdraw_requests: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// Utility: ensure user record
function ensureUser(userId, username) {
  const d = loadData();
  if (!d.users[userId]) {
    d.users[userId] = {
      id: userId,
      username: username || '',
      balance: 0
    };
    saveData(d);
  }
  return d.users[userId];
}

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  ensureUser(chatId, msg.from.username);
  await bot.sendMessage(chatId, "أهلاً بك في Bitcod Bot 🤖\nاستخدم /balance لعرض رصيدك، و /request_withdraw <المبلغ> لطلب سحب.");
});

// /balance
bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const user = ensureUser(chatId, msg.from.username);
  await bot.sendMessage(chatId, `رصيدك الحالي: ${user.balance} وحدة.`);
});

// Admin command: /add_balance <userId> <amount> (for testing / admin use)
bot.onText(/\/add_balance (\d+) (\d+)/, async (msg, match) => {
  const fromId = msg.from.id.toString();
  if (fromId !== ADMIN_ID) return;
  const userId = match[1];
  const amount = parseInt(match[2], 10);
  const d = loadData();
  ensureUser(userId);
  d.users[userId].balance = (d.users[userId].balance || 0) + amount;
  saveData(d);
  await bot.sendMessage(userId, `تم إضافة مبلغ ${amount} إلى رصيدك.`);
  await bot.sendMessage(fromId, `أُضيف المبلغ بنجاح إلى ${userId}.`);
});

// /request_withdraw <amount>
bot.onText(/\/request_withdraw (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const amount = parseInt(match[1], 10);
  const d = loadData();
  ensureUser(chatId, msg.from.username);
  const user = d.users[chatId];

  if (amount <= 0) {
    await bot.sendMessage(chatId, "الرجاء إدخال مبلغ صالح أكبر من 0.");
    return;
  }
  if (user.balance < amount) {
    await bot.sendMessage(chatId, "رصيدك غير كافٍ لطلب هذا السحب.");
    return;
  }

  // create request (status: pending)
  const req = {
    id: Date.now(),
    userId: chatId,
    username: user.username || '',
    amount: amount,
    status: 'pending',
    created_at: new Date().toISOString()
  };
  d.withdraw_requests.push(req);
  saveData(d);

  await bot.sendMessage(chatId, `تم تسجيل طلب السحب بمبلغ ${amount}. سيتم إشعار المشرف لمراجعة الطلب.`);

  // notify admin
  const adminMsg = `🧾 طلب سحب جديد\nالمستخدم: @${req.username || req.userId}\nالمبلغ: ${req.amount}\nطلب رقم: ${req.id}\nللموافقة: استخدم الأمر /pay ${req.userId} ${req.amount} \nأو /reject ${req.id}`;
  await bot.sendMessage(ADMIN_ID, adminMsg);
});

// Admin: list requests /admin_requests
bot.onText(/\/admin_requests/, async (msg) => {
  const fromId = msg.from.id.toString();
  if (fromId !== ADMIN_ID) {
    await bot.sendMessage(msg.chat.id, "هذه الخاصية للمشرف فقط.");
    return;
  }
  const d = loadData();
  const pending = d.withdraw_requests.filter(r => r.status === 'pending');
  if (pending.length === 0) {
    await bot.sendMessage(fromId, "لا توجد طلبات سحب حالياً.");
    return;
  }
  let text = "طلبات السحب المعلقة:\n";
  pending.forEach(r => {
    text += `• رقم: ${r.id} — المستخدم: @${r.username || r.userId} — مبلغ: ${r.amount}\n`;
  });
  await bot.sendMessage(fromId, text);
});

// Admin: /pay <userId> <amount>
bot.onText(/\/pay (\d+) (\d+)/, async (msg, match) => {
  const fromId = msg.from.id.toString();
  if (fromId !== ADMIN_ID) {
    await bot.sendMessage(msg.chat.id, "هذه الخاصية للمشرف فقط.");
    return;
  }
  const userId = match[1];
  const amount = parseInt(match[2], 10);
  const d = loadData();
  ensureUser(userId);
  const user = d.users[userId];
  // find pending request
  const req = d.withdraw_requests.find(r => r.userId.toString() === userId.toString() && r.status === 'pending' && r.amount === amount);
  if (!req) {
    await bot.sendMessage(fromId, "لم أجد طلب سحب مطابق.");
    return;
  }
  // deduct balance and mark as paid
  if ((user.balance || 0) < amount) {
    await bot.sendMessage(fromId, "رصيد المستخدم أقل من المبلغ المطلوب.");
    return;
  }
  user.balance -= amount;
  req.status = 'paid';
  req.paid_at = new Date().toISOString();
  saveData(d);

  await bot.sendMessage(userId, `تم تأكيد سحبك بمبلغ ${amount}. تم الدفع يدوياً من المشرف.`);
  await bot.sendMessage(fromId, `تم تسجيل الدفع للمستخدم ${userId} بمبلغ ${amount}.`);
});

// Admin: /reject <requestId>
bot.onText(/\/reject (\d+)/, async (msg, match) => {
  const fromId = msg.from.id.toString();
  if (fromId !== ADMIN_ID) {
    await bot.sendMessage(msg.chat.id, "هذه الخاصية للمشرف فقط.");
    return;
  }
  const reqId = parseInt(match[1], 10);
  const d = loadData();
  const req = d.withdraw_requests.find(r => r.id === reqId);
  if (!req) {
    await bot.sendMessage(fromId, "طلب غير موجود.");
    return;
  }
  req.status = 'rejected';
  req.rejected_at = new Date().toISOString();
  saveData(d);
  await bot.sendMessage(req.userId, `تم رفض طلب السحب رقم ${req.id}.`);
  await bot.sendMessage(fromId, `تم رفض الطلب ${req.id}.`);
});

// Fallback: echo for unknown messages
bot.on('message', (msg) => {
  // ignore commands (they are handled)
  if (msg.text && msg.text.startsWith('/')) return;
  // keep it simple
  bot.sendMessage(msg.chat.id, "أستخدم الأوامر المتاحة: /balance, /request_withdraw <المبلغ>");
});
