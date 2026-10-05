// Base configuration for Android local server execution
const SERVER_PORT = 3000;
const HOSTNAME = window.location.hostname || 'localhost';
const API_BASE = (window.location.protocol && window.location.protocol.startsWith('http'))
  ? '/api'
  : `http://${HOSTNAME}:${SERVER_PORT}/api`;

let membersList = [];
let activeSelectedID = '';

document.addEventListener('DOMContentLoaded', () => {
  initStatusModule();
});

function initStatusModule() {
  const memberSearch = document.getElementById('memberSearch');
  const closeModalButton = document.getElementById('closeModalButton');
  const infoModal = document.getElementById('infoModal');
  const qrcodeContainer = document.getElementById('qrcode');

  if (memberSearch) {
    memberSearch.addEventListener('input', loadStatus);
  }

  if (closeModalButton) {
    closeModalButton.addEventListener('click', closeModal);
  }

  if (qrcodeContainer) {
    qrcodeContainer.addEventListener('click', openQrPassModal);
  }

  if (infoModal) {
    infoModal.addEventListener('click', (event) => {
      if (event.target === infoModal) closeModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const qrPassModal = document.getElementById('qrPassModal');
      if (qrPassModal && qrPassModal.style.display === 'flex') {
        closeQrPassModal();
      } else if (infoModal && infoModal.style.display === 'flex') {
        closeModal();
      }
    }
  });

  fetchMembers();
}

// Fetch members directly from server or local backend
async function fetchMembers() {
  const statusList = document.getElementById('statusList');
  try {
    const response = await fetch(`${API_BASE}/members`);
    if (!response.ok) throw new Error(`Server status: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Data payload is not an array');
    
    membersList = data;
    loadStatus();
  } catch (error) {
    console.error('Error fetching members:', error);
    if (statusList) {
      statusList.innerHTML = `<p class="status-error">Failed to load members from server.</p>`;
    }
  }
}

// Load and render status cards with sorting and query filtering
function loadStatus() {
  const statusList = document.getElementById('statusList');
  const memberSearch = document.getElementById('memberSearch');
  if (!statusList) return;

  const query = memberSearch ? memberSearch.value.toLowerCase().trim() : '';

  let filteredMembers = membersList.filter((member) => {
    const name = String(member.name || '').toLowerCase();
    const id = getMemberId(member).toLowerCase();
    return name.includes(query) || id.includes(query);
  });

  filteredMembers.sort((a, b) => {
    const aDate = parseLocalDate(getExpiryDate(a));
    const bDate = parseLocalDate(getExpiryDate(b));
    const aTime = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  if (filteredMembers.length === 0) {
    statusList.innerHTML = `<p class="status-message">No members found.</p>`;
    return;
  }

  statusList.innerHTML = filteredMembers.map((member) => {
    const memberId = getMemberId(member);
    const memberName = String(member.name || 'Unnamed Member');
    const targetExpiry = getExpiryDate(member);
    const diffInDays = calculateDaysRemaining(targetExpiry);

    let statusClass = '';
    let badgeText = String(diffInDays);
    let labelText = 'Days Left';

    if (!targetExpiry || diffInDays < 0) {
      statusClass = 'danger';
      badgeText = 'EXP';
      labelText = 'Expired';
    } else if (diffInDays <= 7) {
      statusClass = 'warning';
    }

    const safeId = escapeHtml(memberId);
    const safeName = escapeHtml(memberName);
    const safePhoto = escapeHtml(member.photo || 'https://via.placeholder.com/55');
    const safeExpiry = escapeHtml(formatDisplayDate(targetExpiry));

    return `
      <div class="status-card ${statusClass}" data-member-id="${safeId}" role="button" tabindex="0">
        <img src="${safePhoto}" class="member-card-img" alt="Member Photo" onerror="this.onerror=null;this.src='https://via.placeholder.com/55';" />
        <div class="member-info">
          <p class="member-card-id">${safeId}</p>
          <h3 class="member-card-name">${safeName}</h3>
          <p style="font-size:0.75rem; color:#666; margin:4px 0 0 0;">Expires: ${safeExpiry}</p>
        </div>
        <div class="days-badge">
          <span class="days-num">${escapeHtml(badgeText)}</span>
          <span class="days-label">${escapeHtml(labelText)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Attach card interaction listeners
  const cards = statusList.querySelectorAll('.status-card');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-member-id');
      if (id) fetchAndShowMember(id);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const id = card.getAttribute('data-member-id');
        if (id) fetchAndShowMember(id);
      }
    });
  });
}

// Display selected member details in modal
function fetchAndShowMember(id) {
  const searchId = normalizeId(id);
  const member = membersList.find((item) => normalizeId(getMemberId(item)) === searchId);
  if (member) showDetails(member);
}

function showDetails(member) {
  const infoModal = document.getElementById('infoModal');
  const qrcodeContainer = document.getElementById('qrcode');
  if (!infoModal) return;

  const targetExpiry = getExpiryDate(member);
  const diffInDays = calculateDaysRemaining(targetExpiry);
  const memberName = member.name || 'Unnamed Member';
  activeSelectedID = getMemberId(member);

  document.getElementById('fullName').textContent = memberName;
  document.getElementById('fullID').textContent = `ID: ${activeSelectedID}`;
  document.getElementById('fullExpiry').textContent = formatDisplayDate(targetExpiry);

  const daysRemLabel = document.getElementById('fullDaysRem');
  if (daysRemLabel) {
    if (!targetExpiry || diffInDays < 0) {
      daysRemLabel.textContent = 'Expired Account';
      daysRemLabel.style.color = '#dc3545';
    } else {
      daysRemLabel.textContent = `${diffInDays} Days Remaining`;
      daysRemLabel.style.color = diffInDays <= 7 ? '#ff9800' : '#28a745';
    }
  }

  const fullPhoto = document.getElementById('fullPhoto');
  if (fullPhoto) {
    fullPhoto.src = member.photo || 'https://via.placeholder.com/100';
    fullPhoto.onerror = function () {
      this.onerror = null;
      this.src = 'https://via.placeholder.com/100';
    };
  }

  if (qrcodeContainer) {
    qrcodeContainer.innerHTML = '';
    if (typeof QRCode !== 'undefined' && activeSelectedID) {
      new QRCode(qrcodeContainer, { text: activeSelectedID, width: 120, height: 120 });
    } else {
      qrcodeContainer.innerHTML = `<p style="color:#dc3545;">QR code unavailable</p>`;
    }
  }

  infoModal.style.display = 'flex';
}

function openQrPassModal() {
  const qrPassModal = document.getElementById('qrPassModal');
  const modalQR = document.getElementById('modalQR');
  if (!activeSelectedID || !qrPassModal || !modalQR) return;

  document.getElementById('modalIDText').innerText = activeSelectedID;
  modalQR.innerHTML = '';
  new QRCode(modalQR, { text: activeSelectedID, width: 200, height: 200 });
  qrPassModal.style.display = 'flex';
}

function closeQrPassModal() {
  const qrPassModal = document.getElementById('qrPassModal');
  if (qrPassModal) qrPassModal.style.display = 'none';
}

function closeModal() {
  const infoModal = document.getElementById('infoModal');
  if (infoModal) infoModal.style.display = 'none';
}

// Utility Helpers
function normalizeId(value) {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase().replace(/[\s-]/g, '').trim();
}

function getMemberId(member) {
  return String(member.id || member.memberId || member.member_id || '').trim();
}

function getExpiryDate(member) {
  return member.expiry || member.dateDue || member.date_due || member.datedue || null;
}

function parseLocalDate(dateString) {
  if (!dateString) return null;
  let value = String(dateString).trim();
  if (!value) return null;
  if (value.includes('T')) value = value.split('T')[0];

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    date.setHours(0, 0, 0, 0);
    return isNaN(date.getTime()) ? null : date;
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const date = new Date(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2]));
    date.setHours(0, 0, 0, 0);
    return isNaN(date.getTime()) ? null : date;
  }

  const fallbackDate = new Date(value);
  if (isNaN(fallbackDate.getTime())) return null;
  fallbackDate.setHours(0, 0, 0, 0);
  return fallbackDate;
}

function calculateDaysRemaining(dateString) {
  const target = parseLocalDate(dateString);
  if (!target) return -1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDisplayDate(dateString) {
  if (!dateString || dateString === '---') return '---';
  const date = parseLocalDate(dateString);
  if (!date) return String(dateString);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
