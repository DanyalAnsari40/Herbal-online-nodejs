// // import trackLoc from './api/track_product.json' assert { type: "json" };
// // No import if using fetch (modules not supported by all browsers with import assert)
// const trackBtn = document.querySelector('.btn-track');
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

const trackBtn = document.querySelector('.btn-track');
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
  const p_id = (pIdOverride || (p_id_Input ? p_id_Input.value : '')).trim();

  if (!selected_Service || !p_id) {
    alert("Please select courier and enter tracking ID.");
    return;
  }

  if (selected_Service === 'TCS') {
    const trackURL = `https://www.tcsexpress.com/track/${p_id}`;
    showIframePopup(trackURL);
    return;
  }
  if (selected_Service === 'LEOPARDS') {
    const trackURL = `http://www.leopardscourier.com/shipment_tracking?cn_number=${p_id}`;
    showIframePopup(trackURL);
    return;
  }
  if (selected_Service === 'M&P') {
    const trackURL = `https://www.mulphilog.com/tracking/${p_id}?_token=UwsLwRDWIxO81neG7M6saftVOAWm6aXLRRqSLDtU&consignment=${p_id}`;
    showIframePopup(trackURL);
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
    const value = (trackIdField ? trackIdField.value : '').trim();
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
