(() => {
  const $ = id => document.getElementById(id);
  const screens = ['home', 'onboard', 'customer', 'memory', 'creative'];
  const addresses = { home: 'app.dhanavi.example/home', onboard: 'app.dhanavi.example/assistant', customer: 'dhanavi.example/b/mogra', memory: 'app.dhanavi.example/memory', creative: 'app.dhanavi.example/ideas/festive-preorder' };
  function toast(text) {
    $('design-toast').textContent = text;
    $('design-toast').hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { $('design-toast').hidden = true; }, 5500);
  }
  function showScreen(name, focus = false) {
    if (!screens.includes(name)) return;
    screens.forEach(screen => {
      $(`screen-${screen}`).hidden = screen !== name;
      $(`tab-${screen}`).setAttribute('aria-selected', String(screen === name));
      $(`tab-${screen}`).tabIndex = screen === name ? 0 : -1;
    });
    $('prototype-address').textContent = addresses[name];
    document.querySelector('.app-chrome>span:last-child').textContent = name === 'customer' ? '↗ Public customer chat' : '◈ Private workspace';
    if (focus) $(`tab-${name}`).focus();
  }
  document.querySelectorAll('[data-screen]').forEach(button => {
    button.tabIndex = button.dataset.screen === 'home' ? 0 : -1;
    button.addEventListener('click', () => showScreen(button.dataset.screen));
    button.addEventListener('keydown', event => {
      const index = screens.indexOf(button.dataset.screen);
      let next;
      if (event.key === 'ArrowRight') next = screens[(index + 1) % screens.length];
      if (event.key === 'ArrowLeft') next = screens[(index + screens.length - 1) % screens.length];
      if (event.key === 'Home') next = screens[0];
      if (event.key === 'End') next = screens.at(-1);
      if (next) { event.preventDefault(); showScreen(next, true); }
    });
  });
  document.querySelectorAll('[data-demo-screen]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.demoScreen)));
  document.querySelectorAll('[data-design-toast]').forEach(button => button.addEventListener('click', () => toast(button.dataset.designToast)));
  $('print-doc').addEventListener('click', () => window.print());
  document.querySelectorAll('[data-action="copy-link"]').forEach(button => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText('https://dhanavi.example/b/mogra'); toast('Illustrative link copied. This reserved .example address is a design placeholder, not a live customer link.'); }
    catch { toast('Design placeholder: https://dhanavi.example/b/mogra — not a live business link.'); }
  }));
  let draft = '', confirmedDelivery = '';
  $('save-answer').addEventListener('click', () => {
    draft = $('owner-answer').value.trim();
    if (!draft) { $('owner-answer').focus(); toast('Add your delivery policy before reviewing the reply.'); return; }
    $('answer-draft').textContent = `Kavya confirmed the delivery policy: “${draft}” If you're unsure whether your address falls within this area, please share the locality so the owner can check.`;
    $('answer-review').hidden = false;
    $('answer-saved').hidden = true;
  });
  $('cancel-answer').addEventListener('click', () => { $('answer-review').hidden = true; $('owner-answer').focus(); });
  $('confirm-answer').addEventListener('click', () => {
    confirmedDelivery = draft;
    $('answer-review').hidden = true;
    $('answer-saved').hidden = false;
    $('customer-answer').textContent = `Kavya confirmed: ${confirmedDelivery} If you share your locality, we can check whether your address is within the delivery area.`;
    $('memory-delivery').textContent = confirmedDelivery;
    $('memory-delivery-source').replaceChildren();
    const chip = document.createElement('span'); chip.className = 'status-chip'; chip.textContent = 'Owner confirmed';
    const source = document.createElement('small'); source.textContent = 'Kavya · Approved in this prototype';
    $('memory-delivery-source').append(chip, source);
    $('save-answer').textContent = 'Review update ↗';
    toast('Demo: delivery knowledge saved and the customer answer updated. Open Customer link or Business memory to see the change.');
  });
  $('confirm-menu').addEventListener('click', () => {
    $('onboard-next').hidden = false;
    $('menu-state').textContent = 'Two prices confirmed · Event price still unknown';
    $('confirm-menu').textContent = 'Confirmed ✓';
    $('confirm-menu').disabled = true;
    $('onboard-next').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  });
  $('onboard-hint').addEventListener('click', () => toast('Design prototype: the live product will accept messages and uploads here. No files or business details are sent from this document.'));
  $('human-request').addEventListener('click', () => addPhoneMessage('assistant', 'In the live product, this creates a request for Kavya and pauses the AI when she joins. There is no real owner notification in this prototype.'));
  function addPhoneMessage(sender, text) {
    const bubble = document.createElement('div'); bubble.className = `phone-bubble ${sender}`; bubble.textContent = text;
    $('phone-messages').append(bubble); $('phone-messages').scrollTop = $('phone-messages').scrollHeight;
  }
  document.querySelectorAll('[data-customer-question]').forEach(button => button.addEventListener('click', () => {
    const hours = button.dataset.customerQuestion === 'hours';
    addPhoneMessage('customer', hours ? 'What are your opening hours?' : 'What bouquets do you offer?');
    addPhoneMessage('assistant', hours ? 'Our usual hours are Monday–Saturday, 9 am–7 pm (Asia/Kolkata). Holiday hours are not confirmed. These are illustrative, owner-approved facts in this prototype.' : 'Classic bouquets start at ₹650 and custom arrangements at ₹1,200. Event flowers need a quote from Kavya. These are sample offerings for the design prototype.');
  }));
  function sendCustomerDemo() {
    const text = $('customer-demo-input').value.trim(); if (!text) return;
    addPhoneMessage('customer', text); $('customer-demo-input').value = '';
    const delivery = /deliver|jp nagar/i.test(text);
    addPhoneMessage('assistant', delivery && confirmedDelivery ? `Owner-confirmed demo policy: ${confirmedDelivery}` : 'This is a design prototype, so I cannot generate a live answer. In the product I would check approved business knowledge, or ask the owner if the answer is missing.');
  }
  $('customer-demo-send').addEventListener('click', sendCustomerDemo);
  $('customer-demo-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); sendCustomerDemo(); } });
  let capacity;
  document.querySelectorAll('[data-capacity]').forEach(button => button.addEventListener('click', () => {
    capacity = button.dataset.capacity;
    document.querySelectorAll('[data-capacity]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    $('creative-review').hidden = true;
    $('creative-status').textContent = capacity === 'ask' ? 'Next conversation: ask about available staff, preparation time and existing orders before planning a campaign.' : `Draft capacity: ${capacity} extra bouquets. Price, date and festival relevance still need confirmation.`;
    $('generate-creative').disabled = capacity === 'ask';
  }));
  $('generate-creative').addEventListener('click', () => {
    $('creative-review').hidden = false;
    $('creative-brief').textContent = `Example brief: a small preorder collection of up to ${capacity} extra bouquets, using existing stock. No price, discount or date has been invented. The artwork above is an original HTML layout, not a generated image.`;
    toast('Sample creative brief prepared locally. No model call, image generation or publishing occurred.');
  });
  const observer = new IntersectionObserver(entries => {
    const active = entries.filter(entry => entry.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!active) return;
    document.querySelectorAll('.doc-nav nav a').forEach(link => link.classList.toggle('current', link.hash === '#' + active.target.id));
  }, { rootMargin: '-10% 0px -65% 0px', threshold: 0 });
  document.querySelectorAll('.chapter').forEach(section => observer.observe(section));
})();
