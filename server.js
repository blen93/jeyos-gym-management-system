// @ts-nocheck

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import initSqlJs from 'sql.js';

// Optional Hardware Imports (wrapped safely to prevent app crashes if dependencies are missing)
let escpos, escposNetwork, SerialPort, ReadlineParser;
try {
  escpos = (await import('escpos')).default;
  escposNetwork = (await import('escpos-network')).default;
  if (escpos && escposNetwork) {
    escpos.Network = escposNetwork;
  }
} catch (e) {
  console.warn('ESC/POS printing modules not loaded. Thermal printing disabled.');
}

try {
  const serialModule = await import('serialport');
  const parserModule = await import('@serialport/parser-readline');
  SerialPort = serialModule.SerialPort;
  ReadlineParser = parserModule.ReadlineParser;
} catch (e) {
  console.warn('SerialPort modules not loaded. USB-COM scanner disabled.');
}

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));


/* =========================================================
   PERSISTENT SQLITE DATABASE SETUP (sql.js)
========================================================= */

// Ensures gym.db persists across updates/reinstalls
const storageFolder = process.env.EXTERNAL_STORAGE || path.join(__dirname, 'data');
if (!fs.existsSync(storageFolder)) {
  fs.mkdirSync(storageFolder, { recursive: true });
}

const dbPath = path.join(storageFolder, 'gym.db');
const SQL = await initSqlJs();

let db;
if (fs.existsSync(dbPath)) {
  const filebuffer = fs.readFileSync(dbPath);
  db = new SQL.Database(filebuffer);
} else {
  db = new SQL.Database();
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    member_id TEXT,
    date TEXT,
    data TEXT NOT NULL
  );
`);

saveDatabase();

/*
 * Auto-migrate from gym.json if gym.db is brand new
 */
const jsonPath = path.join(__dirname, 'gym.json');
if (fs.existsSync(jsonPath)) {
  try {
    const rawJson = fs.readFileSync(jsonPath, 'utf8');
    const parsed = JSON.parse(rawJson);

    if (Array.isArray(parsed.members)) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO members (id, data) VALUES (?, ?)`);
      parsed.members.forEach((m) => {
        const mId = getMemberId(m) || generateMemberId();
        const memberData = { ...m, id: mId };
        stmt.run([mId, JSON.stringify(memberData)]);
      });
      stmt.free();
    }

    if (Array.isArray(parsed.attendance)) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO attendance (id, member_id, date, data) VALUES (?, ?, ?, ?)`);
      parsed.attendance.forEach((a) => {
        const aId = String(a.id || Date.now() + Math.random());
        const mId = a.memberId || a.member_id || '';
        const aDate = a.date || '';
        stmt.run([aId, mId, aDate, JSON.stringify(a)]);
      });
      stmt.free();
    }

    saveDatabase();
    console.log('Successfully migrated data from gym.json to gym.db!');
  } catch (err) {
    console.error('Migration from gym.json failed:', err);
  }
}


/* =========================================================
   DATABASE QUERY HELPERS
========================================================= */

function getAllMembers() {
  const stmt = db.prepare('SELECT data FROM members');
  const members = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    try {
      members.push(JSON.parse(row.data));
    } catch (e) {
      console.error('Failed to parse member JSON row:', e);
    }
  }
  stmt.free();
  return members;
}

function saveMemberRecord(memberObj) {
  const mId = getMemberId(memberObj);
  const stmt = db.prepare('INSERT OR REPLACE INTO members (id, data) VALUES (?, ?)');
  stmt.run([mId, JSON.stringify(memberObj)]);
  stmt.free();
  saveDatabase();
}

function deleteMemberRecord(id) {
  const searchId = normalizeId(id);
  const members = getAllMembers();
  const target = members.find((m) => normalizeId(getMemberId(m)) === searchId);

  if (target) {
    const actualId = target.id;
    const stmt = db.prepare('DELETE FROM members WHERE id = ?');
    stmt.run([actualId]);
    stmt.free();
    saveDatabase();
    return target;
  }
  return null;
}

function getAllAttendance() {
  const stmt = db.prepare('SELECT data FROM attendance');
  const logs = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    try {
      logs.push(JSON.parse(row.data));
    } catch (e) {
      console.error('Failed to parse attendance JSON row:', e);
    }
  }
  stmt.free();
  return logs;
}

function saveAttendanceRecord(logObj) {
  const id = String(logObj.id);
  const memberId = String(logObj.memberId || logObj.member_id || '');
  const date = String(logObj.date || '');
  const stmt = db.prepare('INSERT OR REPLACE INTO attendance (id, member_id, date, data) VALUES (?, ?, ?, ?)');
  stmt.run([id, memberId, date, JSON.stringify(logObj)]);
  stmt.free();
  saveDatabase();
}

function deleteAttendanceRecord(id) {
  const searchId = String(id);
  const stmt = db.prepare('DELETE FROM attendance WHERE id = ?');
  stmt.run([searchId]);
  stmt.free();
  saveDatabase();
}


/* =========================================================
   HELPER FUNCTIONS
========================================================= */

// Enhanced normalization to strip non-alphanumeric symbols and clean up JSON strings if scanned
function normalizeId(value) {
  if (!value) return '';
  
  let raw = String(value).trim();

  // If the scanned payload is JSON (e.g., {"id":"JH123456"}), extract the id/qr value
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      raw = parsed.id || parsed.memberId || parsed.qrCode || raw;
    } catch (e) {
      // Keep original raw string if JSON parsing fails
    }
  }

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Strip all spaces, hyphens, and non-alphanumeric characters
    .trim();
}

function getMemberId(member) {
  return (
    member?.id ||
    member?.memberId ||
    member?.member_id ||
    ''
  );
}

function findMemberByScanInput(rawInput) {
  const searchId = normalizeId(rawInput);
  if (!searchId) return null;

  const members = getAllMembers();
  return members.find((item) => {
    const memberId = normalizeId(getMemberId(item));
    const qrCode = normalizeId(item.qrCode);
    return memberId === searchId || (qrCode && qrCode === searchId);
  }) || null;
}

function findMemberById(id) {
  const searchId = normalizeId(id);
  if (!searchId) return null;

  const members = getAllMembers();
  return members.find((member) => normalizeId(getMemberId(member)) === searchId) || null;
}

function parseLocalDate(dateString) {
  if (!dateString) return null;

  let value = String(dateString).trim();
  if (!value) return null;

  if (value.includes('T')) {
    value = value.split('T')[0];
  }

  const parts = value.split(/[-/]/);

  if (parts.length === 3) {
    if (parts[0].length === 4) {
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      const day = Number(parts[2]);
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) return date;
    }

    if (parts[2].length === 4) {
      const month = Number(parts[0]);
      const day = Number(parts[1]);
      const year = Number(parts[2]);
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) return date;
    }
  }

  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateForDatabase(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function getTodayLocalDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getMemberExpiry(member) {
  return (
    member?.expiry ||
    member?.dateDue ||
    member?.date_due ||
    member?.datedue ||
    ''
  );
}

function getMembershipStatus(member) {
  const expiryDate = parseLocalDate(getMemberExpiry(member));
  if (!expiryDate) return 'Active';

  const today = getTodayLocalDate();
  expiryDate.setHours(0, 0, 0, 0);

  if (expiryDate.getTime() < today.getTime()) {
    return 'Expired';
  }

  return 'Active';
}

function generateMemberId() {
  let newId;
  do {
    newId = 'JH' + Math.floor(100000 + Math.random() * 900000);
  } while (findMemberById(newId));

  return newId;
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}


/* =========================================================
   HARDWARE LISTENERS (USB-COM FIXED SCANNER)
========================================================= */

if (SerialPort && ReadlineParser) {
  const SCANNER_PORT = process.env.SCANNER_PORT || 'COM3';

  try {
    const port = new SerialPort({
      path: SCANNER_PORT,
      baudRate: 9600,
      autoOpen: false
    });

    port.open((err) => {
      if (err) {
        console.log(`[USB-COM Scanner] Port ${SCANNER_PORT} not connected. Skipping serial listener.`);
        return;
      }
      console.log(`[USB-COM Scanner] Active and listening on ${SCANNER_PORT}`);
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: /\r?\n/ }));

    parser.on('data', (data) => {
      const rawInput = data.toString().trim();
      if (!rawInput) return;

      console.log(`[Fixed Scanner Received]: "${rawInput}"`);

      const member = findMemberByScanInput(rawInput);

      if (member) {
        const now = new Date();
        const newLog = {
          id: Date.now(),
          memberId: getMemberId(member),
          name: member.name || 'Unknown Member',
          photo: member.photo || 'https://via.placeholder.com/50',
          status: getMembershipStatus(member),
          timestamp: now.getTime(),
          date: formatDateForDatabase(now),
          time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        saveAttendanceRecord(newLog);
        console.log(`[Attendance Logged via USB-COM]: ${member.name} (${getMemberId(member)})`);
      } else {
        console.warn(`[Fixed Scanner Warning]: Scanned input "${rawInput}" did not match any member ID or QR Code.`);
      }
    });

    port.on('error', (err) => {
      console.warn(`[USB-COM Scanner Error]:`, err.message);
    });

  } catch (err) {
    console.warn('[USB-COM Scanner Initialization Skipped]:', err.message);
  }
}


/* =========================================================
   AUTHENTICATION ROUTES
========================================================= */

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo123';

  if (!password) {
    return res.status(400).json({
      success: false,
      message: 'Password is required.'
    });
  }

  if (password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      message: 'Authentication successful.'
    });
  }

  return res.status(401).json({
    success: false,
    message: 'Incorrect password.'
  });
});


/* =========================================================
   HEALTH CHECK & DATABASE BACKUP
========================================================= */

app.get('/api/health', (_req, res) => {
  const members = getAllMembers();
  const attendance = getAllAttendance();

  res.json({
    success: true,
    message: "Jeyo's Hardhit server is running.",
    members: members.length,
    attendance: attendance.length
  });
});

app.get('/api/admin/backup', (_req, res) => {
  try {
    const backupData = {
      members: getAllMembers(),
      attendance: getAllAttendance(),
      exportedAt: new Date().toISOString()
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=gym_backup.json');
    res.send(JSON.stringify(backupData, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to export backup.' });
  }
});

app.post('/api/admin/restore', (req, res) => {
  try {
    const { members, attendance } = req.body || {};

    if (Array.isArray(members)) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO members (id, data) VALUES (?, ?)`);
      members.forEach((m) => {
        const mId = getMemberId(m) || generateMemberId();
        stmt.run([mId, JSON.stringify({ ...m, id: mId })]);
      });
      stmt.free();
    }

    if (Array.isArray(attendance)) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO attendance (id, member_id, date, data) VALUES (?, ?, ?, ?)`);
      attendance.forEach((a) => {
        const aId = String(a.id || Date.now() + Math.random());
        stmt.run([aId, a.memberId || '', a.date || '', JSON.stringify(a)]);
      });
      stmt.free();
    }

    saveDatabase();
    res.json({ success: true, message: 'Data restored successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to restore backup.' });
  }
});


/* =========================================================
   MEMBER MANAGEMENT
========================================================= */

app.get('/api/members', (_req, res) => {
  res.json(getAllMembers());
});

app.get('/api/members/:id', (req, res) => {
  const rawSearch = req.params.id || '';

  if (!normalizeId(rawSearch)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID parameter.'
    });
  }

  const member = findMemberById(rawSearch);

  if (!member) {
    return res.status(404).json({
      success: false,
      message: 'Member not found.'
    });
  }

  res.json(member);
});

app.post('/api/members', async (req, res) => {
  try {
    const body = req.body || {};
    const suppliedId = body.id || body.memberId || body.member_id;

    const memberId = suppliedId
      ? String(suppliedId).trim()
      : generateMemberId();

    if (!memberId) {
      return res.status(400).json({
        success: false,
        message: 'Member ID is required.'
      });
    }

    const existingMember = findMemberById(memberId);

    if (existingMember) {
      const updatedMember = {
        ...existingMember,
        ...body,
        id: existingMember.id || memberId
      };

      saveMemberRecord(updatedMember);

      return res.json({
        success: true,
        message: 'Member already existed. Member updated.',
        member: updatedMember
      });
    }

    const newMember = { ...body, id: memberId };
    saveMemberRecord(newMember);

    res.status(201).json({
      success: true,
      message: 'Member registered successfully.',
      member: newMember
    });

  } catch (error) {
    console.error('Register member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register member.'
    });
  }
});

app.put('/api/members/:id', async (req, res) => {
  try {
    const rawSearch = req.params.id || '';
    const oldMember = findMemberById(rawSearch);

    if (!oldMember) {
      return res.status(404).json({
        success: false,
        message: 'Member not found to update.'
      });
    }

    const body = req.body || {};
    const updatedMember = {
      ...oldMember,
      ...body,
      id: oldMember.id || getMemberId(oldMember) || rawSearch
    };

    saveMemberRecord(updatedMember);

    res.json({
      success: true,
      message: 'Member updated successfully.',
      member: updatedMember
    });

  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update member.'
    });
  }
});

app.patch('/api/members/:id', async (req, res) => {
  try {
    const oldMember = findMemberById(req.params.id);

    if (!oldMember) {
      return res.status(404).json({
        success: false,
        message: 'Member not found.'
      });
    }

    const updatedMember = {
      ...oldMember,
      ...(req.body || {}),
      id: oldMember.id || getMemberId(oldMember) || req.params.id
    };

    saveMemberRecord(updatedMember);

    res.json({
      success: true,
      message: 'Member updated successfully.',
      member: updatedMember
    });

  } catch (error) {
    console.error('Patch member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update member.'
    });
  }
});

app.delete('/api/members/:id', async (req, res) => {
  try {
    const deletedMember = deleteMemberRecord(req.params.id);

    if (!deletedMember) {
      return res.status(404).json({
        success: false,
        message: 'Member not found.'
      });
    }

    res.json({
      success: true,
      message: 'Member deleted successfully.',
      member: deletedMember
    });

  } catch (error) {
    console.error('Delete member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete member.'
    });
  }
});

app.post('/api/members/:id/regenerate-id', async (req, res) => {
  try {
    const oldMember = findMemberById(req.params.id);

    if (!oldMember) {
      return res.status(404).json({
        success: false,
        message: 'Member not found.'
      });
    }

    const oldId = getMemberId(oldMember);
    const newId = generateMemberId();

    deleteMemberRecord(oldId);

    const updatedMember = {
      ...oldMember,
      id: newId
    };

    saveMemberRecord(updatedMember);

    res.json({
      success: true,
      oldId,
      newId,
      message: 'Member ID regenerated successfully.'
    });

  } catch (error) {
    console.error('Regenerate ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate member ID.'
    });
  }
});


/* =========================================================
   ATTENDANCE
========================================================= */

app.get('/api/attendance/today', (_req, res) => {
  const todayStr = formatDateForDatabase(new Date());
  const allLogs = getAllAttendance();

  const todayLogs = allLogs.filter((log) => {
    const logDate = log.date || (log.timestamp ? formatDateForDatabase(new Date(log.timestamp)) : '');
    return logDate === todayStr;
  });

  const enrichedLogs = todayLogs.map((log) => {
    const logMemberId = log.memberId || log.member_id || log.id || '';
    const member = findMemberById(logMemberId) || {};
    const memberId = getMemberId(member) || log.memberId || log.member_id || 'N/A';
    const name = member.name || log.name || `Member #${memberId}`;
    const photo = member.photo || log.photo || 'https://via.placeholder.com/50';
    const status = member.status || log.status || getMembershipStatus(member);
    const time = log.time || (log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    return {
      id: memberId,
      memberId: memberId,
      name,
      photo,
      status,
      time,
      timestamp: log.timestamp || null
    };
  });

  res.json(enrichedLogs.reverse());
});

app.get('/api/attendance', (req, res) => {
  const queryDate = req.query.date;
  const allLogs = getAllAttendance();

  if (queryDate) {
    const filtered = allLogs.filter((log) => log.date === String(queryDate));
    return res.json(filtered);
  }

  res.json(allLogs);
});

app.post('/api/attendance/scan', async (req, res) => {
  try {
    const body = req.body || {};
    const rawInput = body.qrCode || body.id || body.memberId || body.member_id || '';

    if (!rawInput) {
      return res.status(400).json({
        success: false,
        message: 'Invalid scan input.'
      });
    }

    const member = findMemberByScanInput(rawInput);

    if (!member) {
      return res.status(404).json({
        success: false,
        message: `Member matching "${rawInput}" not found.`
      });
    }

    const status = getMembershipStatus(member);
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateString = formatDateForDatabase(now);
    const memberId = getMemberId(member);

    const newLog = {
      id: Date.now(),
      memberId,
      name: member.name || 'Unknown Member',
      photo: member.photo || 'https://via.placeholder.com/50',
      status,
      timestamp: now.getTime(),
      date: dateString,
      time: timeString
    };

    saveAttendanceRecord(newLog);

    res.status(201).json({
      success: true,
      id: memberId,
      memberId,
      name: member.name || 'Unknown Member',
      photo: member.photo || 'https://via.placeholder.com/50',
      status,
      time: timeString,
      timestamp: now.getTime()
    });

  } catch (error) {
    console.error('QR scan error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process QR scan.'
    });
  }
});

app.post('/api/attendance', async (req, res) => {
  try {
    const body = req.body || {};
    const memberId = body.memberId || body.member_id || body.id || '';
    const now = new Date();
    const timestamp = body.timestamp || now.getTime();
    const date = body.date || formatDateForDatabase(new Date(timestamp));
    const time = body.time || new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const log = {
      id: Date.now(),
      memberId,
      name: body.name || '',
      photo: body.photo || '',
      status: body.status || 'Active',
      timestamp,
      date,
      time,
      daysLeft: body.daysLeft
    };

    saveAttendanceRecord(log);

    res.status(201).json(log);

  } catch (error) {
    console.error('Manual attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save attendance.'
    });
  }
});

app.delete('/api/attendance/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const allLogs = getAllAttendance();
    const log = allLogs.find((l) => String(l.id) === id);

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Attendance log not found.'
      });
    }

    deleteAttendanceRecord(id);

    res.json({
      success: true,
      message: 'Attendance log deleted.',
      log
    });

  } catch (error) {
    console.error('Delete attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete attendance log.'
    });
  }
});


/* =========================================================
   RECEIPT PRINTING ENDPOINT
========================================================= */

app.post('/api/print/receipt', async (req, res) => {
  if (!escpos || !escposNetwork) {
    return res.status(500).json({
      success: false,
      message: 'ESC/POS library is not installed on this server.'
    });
  }

  const { memberName, memberId, amount, expiryDate, printerIp } = req.body || {};

  if (!printerIp) {
    return res.status(400).json({
      success: false,
      message: 'Printer IP address required.'
    });
  }

  try {
    const device = new escposNetwork(printerIp, 9100);
    const printer = new escpos.Printer(device);

    device.open((error) => {
      if (error) {
        console.error('Printer Connection Error:', error);
        return res.status(500).json({
          success: false,
          message: 'Could not connect to printer.'
        });
      }

      printer
        .font('a')
        .align('ct')
        .style('b')
        .size(1, 1)
        .text("JEYO'S HARDHIT FITNESS")
        .text('Official Receipt')
        .text('--------------------------------')
        .align('lt')
        .style('normal')
        .text(`Date: ${new Date().toLocaleDateString()}`)
        .text(`Member ID: ${memberId || 'N/A'}`)
        .text(`Name: ${memberName || 'Member'}`)
        .text(`Amount Paid: P${amount || '0.00'}`)
        .text(`Valid Until: ${expiryDate || 'N/A'}`)
        .text('--------------------------------')
        .align('ct')
        .text('Thank you for training with us!')
        .feed(3)
        .cut()
        .close();

      return res.json({
        success: true,
        message: 'Receipt printed successfully.'
      });
    });

  } catch (err) {
    console.error('Print Error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to process print job.'
    });
  }
});


/* =========================================================
   DEFAULT ROUTE & 404 API HANDLER
========================================================= */

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api', (_req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found.'
  });
});


/* =========================================================
   GLOBAL ERROR HANDLER & SERVER START
========================================================= */

app.use((error, _req, res, _next) => {
  console.error('Server error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error.'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  const members = getAllMembers();
  const attendance = getAllAttendance();
  const ips = getLocalIpAddresses();

  console.log(`\n=================================================`);
  console.log(`🏋️ Jeyo's Hardhit Gym System Server Started!`);
  console.log(`-------------------------------------------------`);
  console.log(`Local Access:   http://localhost:${PORT}`);
  
  if (ips.length > 0) {
    console.log(`Network Access: Use these URLs on Device B:`);
    ips.forEach(ip => console.log(`                http://${ip}:${PORT}`));
  } else {
    console.log(`Network Access: Connect to Wi-Fi to share across devices.`);
  }

  console.log(`-------------------------------------------------`);
  console.log(`Database Stats: ${members.length} Members | ${attendance.length} Attendance Logs`);
  console.log(`=================================================\n`);
});
