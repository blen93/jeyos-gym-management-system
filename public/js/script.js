// @ts-nocheck

/* =========================================================
   GLOBAL CONFIGURATION & ENVIRONMENT SETUP
   ========================================================= */

const SERVER_PORT = 3000;

// Set this to your local Wi-Fi IP address where server.js is running (e.g., localhost)
const FALLBACK_SERVER_IP = 'localhost'; 

// Smart Host Resolution: Prevents "localhost" or "file://" failure inside Android WebView
const getResolvedHost = () => {
  const host = window.location.hostname;
  if (!host || host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:') {
    return FALLBACK_SERVER_IP;
  }
  return host;
};

const HOSTNAME = getResolvedHost();

// Dynamic API Base URL
const API_BASE = (window.location.protocol && window.location.protocol.startsWith('http') && window.location.hostname !== 'localhost')
  ? '/api'
  : `http://${HOSTNAME}:${SERVER_PORT}/api`;

/* =========================================================
   AUTHENTICATION & LOGIN
   ========================================================= */

async function handleAdminLogin(event) {
  event.preventDefault();

  const passwordInput = 
    document.getElementById('adminPassword') || 
    document.getElementById('passwordInput') ||
    document.querySelector('input[type="password"]');

  const errorMessageEl = 
    document.getElementById('loginErrorMessage') ||
    document.getElementById('errorMessage');

  const password = passwordInput ? passwordInput.value.trim() : '';

  if (!password) {
    showLoginError(errorMessageEl, 'Please enter a password.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      showLoginError(errorMessageEl, data.message || 'Invalid password.');
      return;
    }

    localStorage.setItem('isLoggedIn', 'true');
    window.location.href = 'home.html';

  } catch (error) {
    console.error('Login error:', error);
    showLoginError(errorMessageEl, 'Server error during login. Please check backend connection.');
  }
}

function showLoginError(element, message) {
  if (element) {
    element.innerText = message;
    element.style.display = 'block';
  } else {
    alert(message);
  }
}

/* =========================================================
   MEMBER UTILITIES & PARSERS
   ========================================================= */

function getMemberId(member) {
  if (!member) return '';
  return String(member.id || member.memberId || member.member_id || '').trim();
}

function normalizeMemberId(value) {
  return String(value || '').toLowerCase().replace(/[\s-]/g, '').trim();
}

function getMemberExpiry(member) {
  if (!member) return '';
  return member.expiry || member.dateDue || member.date_due || member.datedue || '';
}

function parseLocalDate(dateString) {
  if (!dateString) return null;
  let value = String(dateString).trim();
  if (!value) return null;

  if (value.includes('T')) {
    value = value.split('T')[0];
  }

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    date.setHours(0, 0, 0, 0);
    return isNaN(date.getTime()) ? null : date;
  }

  const usMatch = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (usMatch) {
    const date = new Date(Number(usMatch[3]), Number(usMatch[1]) - 1, Number(usMatch[2]));
    date.setHours(0, 0, 0, 0);
    return isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(value);
  if (isNaN(fallback.getTime())) return null;
  fallback.setHours(0, 0, 0, 0);
  return fallback;
}

function getTodayLocal() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function calculateDaysRemaining(dateString) {
  const target = parseLocalDate(dateString);
  if (!target) return -1;
  const today = getTodayLocal();
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDisplayDate(dateString) {
  if (!dateString || dateString === '---') return '---';
  const date = parseLocalDate(dateString);
  if (!date) return String(dateString);

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* =========================================================
   MEMBER REGISTRATION
   ========================================================= */

async function handleRegistration(event) {
  event.preventDefault();

  const nameInput = document.getElementById('memberName');
  const planInput = document.getElementById('membershipPlan');
  const amountInput = document.getElementById('amountPaid');
  const expiryInput = document.getElementById('expiryDate');

  const memberData = {
    name: nameInput ? nameInput.value.trim() : '',
    plan: planInput ? planInput.value : '',
    amount: amountInput ? parseFloat(amountInput.value) || 0 : 0,
    expiry: expiryInput ? expiryInput.value : ''
  };

  if (!memberData.name) {
    alert('Please enter a valid member name.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memberData)
    });

    if (!response.ok) {
      const errRes = await response.json().catch(() => ({}));
      throw new Error(errRes.message || `Failed to create member (${response.status})`);
    }

    const createdMember = await response.json();

    if (typeof window.showQrModal === 'function') {
      window.showQrModal(createdMember);
    } else {
      alert(`Member registered successfully!\nID: ${getMemberId(createdMember) || 'N/A'}`);
    }

    const form = document.getElementById('registerForm');
    if (form) form.reset();

  } catch (error) {
    console.error('Error registering member:', error);
    alert(error.message || 'Error registering member. Check server connection.');
  }
}

/* =========================================================
   ATTENDANCE MODULES
   ========================================================= */

async function recordAttendance(memberId) {
  if (!memberId) return null;

  try {
    const response = await fetch(`${API_BASE}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, memberId: memberId })
    });

    if (!response.ok) {
      throw new Error(`Failed to record attendance (${response.status})`);
    }

    return await response.json();

  } catch (error) {
    console.error('Error recording attendance:', error);
    alert('Failed to log attendance. Please check backend server.');
    return null;
  }
}

async function scanAttendance(memberId) {
  if (!memberId) return null;

  try {
    const response = await fetch(`${API_BASE}/attendance/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrCode: memberId, id: memberId, memberId: memberId })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || 'Attendance scan failed');
    }

    return result;

  } catch (error) {
    console.error('QR attendance error:', error);
    alert(error.message || 'Failed to record attendance.');
    return null;
  }
}

/* =========================================================
   MEMBER DATA FETCHING
   ========================================================= */

async function fetchAllMembers() {
  try {
    const response = await fetch(`${API_BASE}/members`);
    if (!response.ok) throw new Error(`Failed to fetch members (${response.status})`);
    const members = await response.json();
    return Array.isArray(members) ? members : [];
  } catch (error) {
    console.error('Error fetching members:', error);
    return [];
  }
}

function findMemberById(members, memberId) {
  if (!Array.isArray(members)) return null;
  const searchId = normalizeMemberId(memberId);
  if (!searchId) return null;

  return members.find(member => normalizeMemberId(getMemberId(member)) === searchId) || null;
}

/* =========================================================
   DASHBOARD & LOGS MANAGEMENT
   ========================================================= */

async function loadDashboardData() {
  try {
    const members = await fetchAllMembers();
    const today = getTodayLocal();
    const millisecondsPerDay = 24 * 60 * 60 * 1000;

    let activeCount = 0;
    let warningCount = 0;
    let estimatedRevenue = 0;

    members.forEach(member => {
      const expiryDate = getMemberExpiry(member);
      if (!expiryDate) return;

      const expiry = parseLocalDate(expiryDate);
      if (!expiry) return;

      const daysRemaining = Math.ceil((expiry.getTime() - today.getTime()) / millisecondsPerDay);

      if (daysRemaining >= 0) {
        activeCount++;
        const amount = parseFloat(member.amount || member.fee || 0);
        if (!isNaN(amount)) estimatedRevenue += amount;
        if (daysRemaining <= 7) warningCount++;
      }
    });

    const activeElement = document.getElementById('activeCountVal');
    const warningElement = document.getElementById('warningCountVal');
    const cashElement = document.getElementById('cashFlowVal');

    if (activeElement) activeElement.innerText = String(activeCount);
    if (warningElement) warningElement.innerText = String(warningCount);
    if (cashElement) {
      cashElement.innerText = '₱' + estimatedRevenue.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    await loadDashboardLogs(members);

  } catch (error) {
    console.error('Error updating dashboard:', error);
  }
}

async function loadDashboardLogs(cachedMembers = null) {
  const container = document.getElementById('recentLogsContainer');
  const datePicker = document.getElementById('logFilterDatePicker');

  if (!container || !datePicker) return;

  try {
    const targetDate = datePicker.value;
    if (!targetDate) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:#999;font-size:0.85rem;">Select a date.</div>`;
      return;
    }

    const logsResponse = await fetch(`${API_BASE}/attendance?date=${encodeURIComponent(targetDate)}`);
    const logs = logsResponse.ok ? await logsResponse.json() : [];

    let members = cachedMembers;
    if (!Array.isArray(members)) {
      members = await fetchAllMembers();
    }

    const memberMap = new Map();
    members.forEach(member => {
      const id = getMemberId(member);
      if (id) memberMap.set(normalizeMemberId(id), member);
    });

    if (!Array.isArray(logs) || logs.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:#999;font-size:0.85rem;">No check-in entries found for this date.</div>`;
      return;
    }

    logs.sort((a, b) => getLogTimestamp(b) - getLogTimestamp(a));

    container.innerHTML = logs.map(log => {
      const rawId = log.member_id || log.memberId || log.memberNo || '';
      const displayId = String(rawId || '---');
      const normalizedId = normalizeMemberId(rawId);
      const member = memberMap.get(normalizedId);

      const memberName = log.name || log.memberName || (member ? member.name : null) || (rawId ? `Member #${rawId}` : 'Unknown Member');
      let displayTime = log.time || '';
      const timestamp = log.timestamp || log.created_at || log.date || '';

      if (!displayTime && timestamp) {
        const date = new Date(timestamp);
        if (!isNaN(date.getTime())) {
          displayTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      }

      return `
        <div class="log-row">
          <div class="log-user">
            <div>
              <span class="log-name">${escapeHtml(memberName)}</span>
              <span class="log-id">ID: ${escapeHtml(displayId)}</span>
            </div>
          </div>
          <div class="log-time">${escapeHtml(displayTime || '--:--')}</div>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Error loading logs:', error);
    container.innerHTML = `<div style="text-align:center;padding:20px;color:#dc3545;font-size:0.85rem;">Failed to load attendance logs.</div>`;
  }
}

function getLogTimestamp(log) {
  if (!log) return 0;
  if (log.timestamp && !isNaN(new Date(log.timestamp).getTime())) return new Date(log.timestamp).getTime();
  if (log.created_at && !isNaN(new Date(log.created_at).getTime())) return new Date(log.created_at).getTime();
  if (log.date && !isNaN(new Date(log.date).getTime())) return new Date(log.date).getTime();
  if (typeof log.id === 'number') return log.id;
  return 0;
}

/* =========================================================
   DOM INITIALIZATION
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm') || document.getElementById('adminLoginForm') || document.querySelector('form');
  const path = window.location.pathname.toLowerCase();
  const isLoginPage = path.endsWith('index.html') || path === '/' || path.endsWith('/');

  if (loginForm && isLoginPage) {
    loginForm.addEventListener('submit', handleAdminLogin);
  }

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegistration);
  }

  if (document.getElementById('recentLogsContainer')) {
    loadDashboardData();
  }

  const datePicker = document.getElementById('logFilterDatePicker');
  if (datePicker) {
    datePicker.addEventListener('change', () => loadDashboardLogs());
  }

  initMovableLogout();
});

/* =========================================================
   MOVABLE LOGOUT BUTTON & DIALOG
   ========================================================= */

function initMovableLogout() {
  const currentPage = window.location.pathname.split('/').pop().toLowerCase();
  if (currentPage === 'index.html' || currentPage === '') return;

  const style = document.createElement('style');
  style.innerHTML = `
    .float-logout-btn {
      position: fixed; bottom: 100px; right: 20px;
      width: 52px; height: 52px; border-radius: 50%;
      background-color: #1a1a1a; color: #ffcc00;
      border: 2px solid #ffcc00; box-shadow: 0 6px 16px rgba(0,0,0,0.35);
      font-size: 1.3rem; cursor: grab; z-index: 9999;
      display: flex; justify-content: center; align-items: center;
      user-select: none; touch-action: none; transition: transform 0.1s ease;
    }
    .float-logout-btn:active { transform: scale(0.95); }
    .float-modal-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.7); display: flex; justify-content: center;
      align-items: center; z-index: 10000; opacity: 0; pointer-events: none;
      transition: opacity 0.3s ease; backdrop-filter: blur(5px);
    }
    .float-modal-overlay.active { opacity: 1; pointer-events: auto; }
    .float-modal-card {
      background: #ffffff; padding: 25px 20px; border-radius: 20px;
      width: 85%; max-width: 320px; text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.3); transform: translateY(20px);
      transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .float-modal-overlay.active .float-modal-card { transform: translateY(0); }
    .float-modal-icon { font-size: 3rem; color: #ffcc00; margin-bottom: 12px; }
    .float-modal-card h3 { font-family: 'Oswald', sans-serif; margin: 0 0 8px; font-size: 1.4rem; text-transform: uppercase; color: #1a1a1a; }
    .float-modal-card p { color: #555; margin-bottom: 22px; font-size: 0.95rem; line-height: 1.4; font-family: 'Roboto', sans-serif; }
    .float-modal-btns { display: flex; gap: 10px; }
    .float-m-btn { flex: 1; padding: 12px; border-radius: 10px; border: none; font-family: 'Oswald', sans-serif; cursor: pointer; font-size: 0.95rem; text-transform: uppercase; }
    .float-btn-no { background: #eeeeee; color: #333333; font-weight: bold; }
    .float-btn-yes { background: #1a1a1a; color: #ffcc00; box-shadow: 0 4px 0 #000; font-weight: bold; }
    .float-btn-yes:active { transform: translateY(2px); box-shadow: 0 2px 0 #000; }
  `;
  document.head.appendChild(style);

  const modalHTML = `
    <div class="float-modal-overlay" id="autoLogoutModal">
      <div class="float-modal-card">
        <i class="fa-solid fa-right-from-bracket float-modal-icon"></i>
        <h3>LOGOUT</h3>
        <p>Do you want to exit?</p>
        <div class="float-modal-btns">
          <button class="float-m-btn float-btn-no" id="cancelLogoutBtn">CANCEL</button>
          <button class="float-m-btn float-btn-yes" id="confirmLogoutBtn">LOGOUT</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const floatButton = document.createElement('button');
  floatButton.className = 'float-logout-btn';
  floatButton.innerHTML = '<i class="fa-solid fa-power-off"></i>';
  floatButton.setAttribute('title', 'Logout');
  floatButton.setAttribute('aria-label', 'Logout');
  document.body.appendChild(floatButton);

  const modalOverlay = document.getElementById('autoLogoutModal');
  const cancelButton = document.getElementById('cancelLogoutBtn');
  const confirmButton = document.getElementById('confirmLogoutBtn');

  if (!modalOverlay || !cancelButton || !confirmButton) return;

  function openLogoutModal() { modalOverlay.classList.add('active'); }
  function closeLogoutModal() { modalOverlay.classList.remove('active'); }

  cancelButton.addEventListener('click', closeLogoutModal);
  confirmButton.addEventListener('click', () => {
    localStorage.removeItem('isLoggedIn');
    window.location.href = 'index.html';
  });

  modalOverlay.addEventListener('click', event => {
    if (event.target === modalOverlay) closeLogoutModal();
  });

  let isDragging = false, startX = 0, startY = 0, initialLeft = 0, initialTop = 0, hasMoved = false;

  function getPointerPosition(event) {
    if (event.touches && event.touches.length > 0) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    return { x: event.clientX, y: event.clientY };
  }

  function onDragStart(event) {
    isDragging = true;
    hasMoved = false;
    const pointer = getPointerPosition(event);
    startX = pointer.x;
    startY = pointer.y;
    const rect = floatButton.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    floatButton.style.cursor = 'grabbing';
  }

  function onDragMove(event) {
    if (!isDragging) return;
    const pointer = getPointerPosition(event);
    const deltaX = pointer.x - startX;
    const deltaY = pointer.y - startY;

    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) hasMoved = true;

    let newLeft = initialLeft + deltaX;
    let newTop = initialTop + deltaY;

    const maxLeft = window.innerWidth - floatButton.offsetWidth - 10;
    const maxTop = window.innerHeight - floatButton.offsetHeight - 10;

    newLeft = Math.max(10, Math.min(newLeft, maxLeft));
    newTop = Math.max(10, Math.min(newTop, maxTop));

    floatButton.style.left = `${newLeft}px`;
    floatButton.style.top = `${newTop}px`;
    floatButton.style.right = 'auto';
    floatButton.style.bottom = 'auto';

    if (event.cancelable) event.preventDefault();
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    floatButton.style.cursor = 'grab';
  }

  floatButton.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  floatButton.addEventListener('touchstart', onDragStart, { passive: true });
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend', onDragEnd);

  floatButton.addEventListener('click', () => {
    if (hasMoved) return;
    openLogoutModal();
  });
}
