// // import trackLoc from './api/track_product.json' assert { type: "json" };
// // No import if using fetch (modules not supported by all browsers with import assert)
// // Select a non-modal Track button (exclude the modal submit to avoid double-handling)
const trackBtn = document.querySelector('.btn-track:not(#trackIdSubmit)');
// // const usernameInput = document.querySelector('#username');
// // const passwordInput = document.querySelector('#password');
// const p_id_Input = document.querySelector('#p_id');
// const modalOverlay = document.querySelector('#modalOverlay');
// const closeModalBtn = document.querySelector('#closeModal');
// const trackingHeader = document.querySelector('#trackingHeader');
// const timeline = document.querySelector('#timeline');
// const service = document.querySelector('#service');

// // Fetch and track logic
// trackBtn.addEventListener('click', async () => {
//   // const username = usernameInput.value.trim();
//   const selected_Service = service.value.trim();
//   const p_id = p_id_Input.value.trim();


//   // if (username !== 'user' || password !== '123') {
//   //   alert('Invalid username or password');
//   //   return;
//   // }

function buildMnpResultsHtml(data) {
  const arr = Array.isArray(data) ? data : [];
  const root = arr[0] || {};
  const detailsList = Array.isArray(root.tracking_Details) ? root.tracking_Details : [];
  if (detailsList.length === 0) {
    return `<div class="p-6 text-gray-600">No results found.</div>`;
  }
  const t = detailsList[0];
  const header = `
    <div class="tracking-header">
      <h3 class="text-lg font-semibold">Tracking</h3>
      <div class="route">
        <i class="fas fa-route"></i>
        <span>${escapeHtml(t.Origin || 'N/A')} → ${escapeHtml(t.Destination || 'N/A')}</span>
      </div>
    </div>`;

  const infoRows = [
    ['Booking Date', t.BookingDate],
    ['Service', t.ServiceType],
    ['Pieces', t.pieces],
    ['Weight', t.weight],
    ['Status', t.CNStatus],
    ['Status ID', t.CNStatusID],
    ['Shipper', t.Shipper],
    ['Consignee', t.Consignee]
  ];

  const infoTable = `
    <div class="overflow-x-auto">
      <table class="min-w-full text-sm">
        <tbody>
          ${infoRows.map(([k,v]) => `
            <tr class="border-b">
              <td class="px-3 py-2 font-medium text-gray-700">${escapeHtml(k)}</td>
              <td class="px-3 py-2 text-gray-800">${escapeHtml(v ?? '—')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  const steps = Array.isArray(t.Details) ? t.Details : [];
  const detailTable = steps.length > 0 ? `
    <div class="mt-6">
      <h4 class="text-md font-semibold mb-2">Tracking Detail</h4>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-700">
            <tr>
              <th class="px-3 py-2 text-left">Status</th>
              <th class="px-3 py-2 text-left">Location</th>
              <th class="px-3 py-2 text-left">Date/Time</th>
              <th class="px-3 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            ${steps.map(d => `
              <tr class="border-b">
                <td class="px-3 py-2">${escapeHtml(d.Status || '')}</td>
                <td class="px-3 py-2">${escapeHtml(d.Location || '')}</td>
                <td class="px-3 py-2">${escapeHtml(d.DateTime || '')}</td>
                <td class="px-3 py-2">${escapeHtml(d.Detail || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  return `${header}${infoTable}${detailTable}`;
}

function buildLeopardsResultsHtml(data) {
  const packets = Array.isArray(data.packet_list) ? data.packet_list : [];
  if (packets.length === 0) {
    return `<div class="p-6 text-gray-600">No results found.</div>`;
  }
  const p = packets[0];
  const header = `
    <div class="tracking-header">
      <h3 class="text-lg font-semibold">Tracking: ${escapeHtml(p.track_number || '')}</h3>
      <div class="route">
        <i class="fas fa-route"></i>
        <span>${escapeHtml(p.origin_city_name || 'N/A')} → ${escapeHtml(p.destination_city_name || 'N/A')}</span>
      </div>
    </div>`;

  const infoRows = [
    ['Booking Date', p.booking_date],
    ['Weight', p.booked_packet_weight],
    ['Pieces', p.booked_packet_no_piece],
    ['Collect Amount', p.booked_packet_collect_amount],
    ['Order ID', p.booked_packet_order_id],
    ['Invoice #', p.invoice_number],
    ['Invoice Date', p.invoice_date],
    ['Status', p.booked_packet_status],
    ['Activity Date', p.activity_date],
    ['Status Remarks', p.status_reamrks]
  ];

  const infoTable = `
    <div class="overflow-x-auto">
      <table class="min-w-full text-sm">
        <tbody>
          ${infoRows.map(([k,v]) => `
            <tr class="border-b">
              <td class="px-3 py-2 font-medium text-gray-700">${escapeHtml(k)}</td>
              <td class="px-3 py-2 text-gray-800">${escapeHtml(v ?? '—')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  const details = Array.isArray(p['Tracking Detail']) ? p['Tracking Detail'] : [];
  const detailTable = details.length > 0 ? `
    <div class="mt-6">
      <h4 class="text-md font-semibold mb-2">Tracking Detail</h4>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-700">
            <tr>
              <th class="px-3 py-2 text-left">Status</th>
              <th class="px-3 py-2 text-left">Receiver</th>
              <th class="px-3 py-2 text-left">Activity Date</th>
              <th class="px-3 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            ${details.map(d => `
              <tr class="border-b">
                <td class="px-3 py-2">${escapeHtml(d['Staus'] || d['Status'] || '')}</td>
                <td class="px-3 py-2">${escapeHtml(d['Reciever Name'] || d['Receiver Name'] || '')}</td>
                <td class="px-3 py-2">${escapeHtml(d['Activity Date'] || '')}</td>
                <td class="px-3 py-2">${escapeHtml(d['Reason'] || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  return `${header}${infoTable}${detailTable}`;
}

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
//             //! Checking the servive type?
  
//   const serviceUrlMap = {
//     'TCS': '/api/track_product.json',
//     'N&P': '/api/n_p.json',
//     'LEOPARDS': '/api/n_p.json',
//     'PAK-POST': null
//   };

//   const url = serviceUrlMap[selected_Service];

//   if (!url) {
//     alert('Selected service is not supported for tracking.');
//     return;
//   }
    
       
//   try {
//     const response = await fetch(url);
//     const trackLoc = await response.json();

//     const match = trackLoc.find(item =>
//       item.tracking_Details[0].Consignment === p_id
//     );

//     if (!match) {
//       alert('No consignment found with that number');
//       return;
//     }

//     const trackingDetails = match.tracking_Details[0];
//     const steps = trackingDetails.Details;

//     trackingHeader.innerHTML = `
//       <h3>Status: <span style="color: ${getStatusColor(trackingDetails.CNStatus)}">${trackingDetails.CNStatus}</span></h3>
//       <div class="route">
//         <span>From: ${trackingDetails.Origin}</span>
//         <i class="fas fa-arrow-right"></i>
//         <span>To: ${trackingDetails.Destination}</span>
//       </div>
//       <p>Consignment: ${trackingDetails.Consignment}</p>
//     `;

//     createTimeline(steps);
//     showModal();

//   } catch (error) {
//     alert('Error fetching tracking data.');
//     console.error(error);
//   }
// });

// // Modal handlers
// function showModal() {
//   modalOverlay.classList.add('active');
//   document.body.style.overflow = 'hidden';
// }
// function hideModal() {
//   modalOverlay.classList.remove('active');
//   document.body.style.overflow = 'auto';
// }
// modalOverlay.addEventListener('click', (e) => {
//   if (e.target === modalOverlay) hideModal();
// });
// closeModalBtn.addEventListener('click', hideModal);

// // Create timeline UI
// function createTimeline(steps) {
//   timeline.innerHTML = '';
//   steps.forEach((step, index) => {
//     const timelineItem = document.createElement('div');
//     timelineItem.className = `timeline-item ${index === steps.length - 1 ? 'current' : ''}`;
//     timelineItem.style.animationDelay = `${index * 0.2}s`;

//     timelineItem.innerHTML = `
//       <h4>${step.Status}</h4>
//       <p><i class="fas fa-map-marker-alt"></i> ${step.Location}</p>
//       <p><i class="fas fa-clock"></i> ${step.DateTime}</p>
//     `;
//     timeline.appendChild(timelineItem);
//   });
// }

// // Status color logic
// function getStatusColor(status) {
//   switch (status) {
//     case 'Delivered': return '#4CAF50';
//     case 'In Transit': return '#2196F3';
//     case 'Out for Delivery': return '#FF9800';
//     case 'Processing': return '#9C27B0';
//     default: return '#673AB7';
//   }
// }

// // Input icon and label animation
// document.querySelectorAll('.form-group.floating input').forEach(input => {
//   input.addEventListener('focus', () => {
//     input.parentElement.querySelector('i').style.color = 'var(--primary)';
//     input.parentElement.querySelector('label').style.color = 'var(--primary)';
//   });
//   input.addEventListener('blur', () => {
//     if (!input.value) {
//       input.parentElement.querySelector('i').style.color = 'var(--gray)';
//       input.parentElement.querySelector('label').style.color = 'var(--gray)';
//     }
//   });
// });

// use the trackBtn declared at top ('.btn-track:not(#trackIdSubmit)')
const p_id_Input = document.querySelector('#p_id'); // may be absent when using modal
const modalOverlay = document.querySelector('#modalOverlay');
const modalContent = document.querySelector('#modalContent');
const closeModalBtn = document.querySelector('#closeModal');
const carrierButtons = Array.from(document.querySelectorAll('.carrier-btn'));
let selectedCarrier = null;
// Track ID modal elements
const trackIdModal = document.querySelector('#trackIdModal');
const trackIdField = document.querySelector('#trackIdField');
const trackIdClose = document.querySelector('#trackIdClose');
const trackIdSubmit = document.querySelector('#trackIdSubmit');

if (trackBtn) {
  trackBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    // If using modal flow, invoke it instead of reading inline input
    if (trackIdModal && selectedCarrier) {
      openTrackIdModal();
      return;
    }
    runTracking();
  });
}

function runTracking(pIdOverride) {
  const selected_Service = (selectedCarrier || '').trim();
  let p_id = (pIdOverride || (p_id_Input ? p_id_Input.value : '')).trim();
  if (!p_id) {
    const field = document.querySelector('#trackIdField');
    p_id = (field ? field.value : '').trim();
  }

  if (!selected_Service || !p_id) {
    console.warn('[TRACK] Missing input', { selected_Service, p_id_length: (p_id||'').length });
    alert("Please select courier and enter tracking ID.");
    return;
  }

  if (selected_Service === 'TCS') {
    const trackURL = `https://www.tcsexpress.com/track/${p_id}`;
    showIframePopup(trackURL);
    return;
  }
  if (selected_Service === 'LEOPARDS') {
    // Use backend proxy to keep credentials on server
    fetch('/api/track/leopards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_numbers: p_id }),
      credentials: 'same-origin'
    })
      .then(async (r) => {
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          throw new Error('Not JSON');
        }
        const data = await r.json();
        return { ok: r.ok, data };
      })
      .then(({ ok, data }) => {
        if (!ok || !data || data.status !== 1) {
          const msg = data && (data.message || data.error) ? (data.message || data.error) : 'Unable to fetch tracking info';
          modalContent.innerHTML = `<div class="p-4 text-red-600">${msg}</div>`;
          modalOverlay.classList.add('active');
          document.body.style.overflow = 'hidden';
          return;
        }
        const html = buildLeopardsResultsHtml(data);
        modalContent.innerHTML = html;
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      })
      .catch(err => {
        modalContent.innerHTML = `<div class="p-4 text-red-600">Request failed. Please ensure you are logged in and try again.</div>`;
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      });
    return;
  }
  if (selected_Service === 'M&P') {
    fetch('/api/track/mnp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consignment: p_id }),
      credentials: 'same-origin'
    })
      .then(async (r) => {
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) { throw new Error('Not JSON'); }
        const data = await r.json();
        return { ok: r.ok, data };
      })
      .then(({ ok, data }) => {
        if (!ok || !data) {
          modalContent.innerHTML = `<div class="p-4 text-red-600">Unable to fetch tracking info</div>`;
          modalOverlay.classList.add('active');
          document.body.style.overflow = 'hidden';
          return;
        }
        const html = buildMnpResultsHtml(data);
        modalContent.innerHTML = html;
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      })
      .catch(err => {
        modalContent.innerHTML = `<div class="p-4 text-red-600">Request failed. Please ensure you are logged in and try again.</div>`;
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      });
    return;
  }
  if (selected_Service === 'POSTEX') {
    // Placeholder URL; will be replaced when backend integration is added
    const trackURL = `https://merchant.postex.pk/track/${encodeURIComponent(p_id)}`;
    showIframePopup(trackURL);
    return;
  }

  alert("Selected service is not supported yet.");
}

function showIframePopup(url) {
  modalContent.innerHTML = `<iframe src="${url}" width="100%" height="600px" style="border:0;"></iframe>`;
  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

closeModalBtn.addEventListener('click', () => {
  modalOverlay.classList.remove('active');
  modalContent.innerHTML = '';
  document.body.style.overflow = 'auto';
});

// ------------------
// Enable icon and label animations
document.querySelectorAll('.form-group.floating input').forEach(input => {
  input.addEventListener('focus', () => {
    input.parentElement.querySelector('i').style.color = 'var(--primary)';
    input.parentElement.querySelector('label').style.color = 'var(--primary)';
  });
  input.addEventListener('blur', () => {
    if (!input.value) {
      input.parentElement.querySelector('i').style.color = 'var(--gray)';
      input.parentElement.querySelector('label').style.color = 'var(--gray)';
    }
  });
});

// ------------------
// Allow auto-fill if navigated with ?service=TCS&p_id=123
window.addEventListener('DOMContentLoaded', () => {
  // Button selection handling
  carrierButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // clear previous selection
      carrierButtons.forEach(b => {
        b.classList.remove('ring-2', 'ring-orange-400', 'success-glow');
        b.setAttribute('aria-pressed', 'false');
      });
      // set selection
      selectedCarrier = btn.dataset.carrier;
      btn.classList.add('ring-2', 'ring-orange-400', 'success-glow');
      btn.setAttribute('aria-pressed', 'true');
      // open modal for tracking ID entry
      openTrackIdModal();
    });
  });

  // URL params autofill
  const params = new URLSearchParams(window.location.search);
  const serviceParam = params.get('service');
  const idParam = params.get('p_id');

  if (serviceParam) {
    const target = carrierButtons.find(b => (b.dataset.carrier || '').toLowerCase() === serviceParam.toLowerCase());
    if (target) {
      target.click();
    }
  }
  if (idParam) {
    if (p_id_Input) p_id_Input.value = idParam;
  }
});

// Modal helpers
function openTrackIdModal() {
  if (!trackIdModal) return;
  trackIdModal.classList.add('active');
  if (trackIdField) {
    trackIdField.value = '';
    setTimeout(() => trackIdField.focus(), 0);
  }
}

if (trackIdClose) {
  trackIdClose.addEventListener('click', () => {
    trackIdModal.classList.remove('active');
  });
}

if (trackIdModal) {
  trackIdModal.addEventListener('click', (e) => {
    if (e.target === trackIdModal) {
      trackIdModal.classList.remove('active');
    }
  });
}

if (trackIdSubmit) {
  trackIdSubmit.addEventListener('click', () => {
    // Read fresh in case of dynamic changes
    const field = document.querySelector('#trackIdField');
    const value = (field ? field.value : '').trim();
    console.log('[TRACK] submit clicked', { selectedCarrier, valueLength: value.length, value });
    if (!value) {
      alert('Please enter a tracking number.');
      return;
    }
    trackIdModal.classList.remove('active');
    runTracking(value);
  });
}

if (trackIdField) {
  trackIdField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      trackIdSubmit.click();
    }
  });
}
