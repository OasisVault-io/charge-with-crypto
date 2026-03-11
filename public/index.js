const templateButtons = [...document.querySelectorAll('[data-template]')];
const form = document.getElementById('demoCheckoutForm');
const statusNode = document.getElementById('demoStatus');
const titleInput = document.getElementById('demoTitle');
const descriptionInput = document.getElementById('demoDescription');

let selectedTemplate = 'neutral';

function persistCheckoutBootstrap(payload) {
  const checkoutId = payload?.checkout?.id;
  if (!checkoutId) return;
  try {
    window.sessionStorage?.setItem(`checkout-bootstrap:${checkoutId}`, JSON.stringify({
      checkout: payload.checkout,
      quote: payload.quote || null,
      quotes: payload.quotes || []
    }));
  } catch (_err) {
  }
}

function setTemplate(template) {
  selectedTemplate = template;
  document.body.dataset.template = template;
  templateButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.template === template);
  });

  if (template === 'oasis') {
    if (!titleInput.dataset.userEdited) titleInput.value = 'OasisVault test payment';
    if (!descriptionInput.dataset.userEdited) descriptionInput.value = 'Connect a wallet, review the best route, and pay in one confirmation.';
    return;
  }

  if (!titleInput.dataset.userEdited) titleInput.value = 'Charge with Crypto test payment';
  if (!descriptionInput.dataset.userEdited) descriptionInput.value = 'Test the wallet-first checkout flow with your own receiving address.';
}

function markEdited(event) {
  event.target.dataset.userEdited = 'true';
}

async function createDemoCheckout(event) {
  event.preventDefault();
  statusNode.textContent = '';

  const recipient = document.getElementById('demoRecipient').value.trim();
  const amountUsd = Number(document.getElementById('demoAmount').value);
  const title = titleInput.value.trim();
  const description = descriptionInput.value.trim();
  const merchantId = selectedTemplate === 'oasis' ? 'merchant_default' : 'merchant_demo';
  const recipientAddresses = {
    ethereum: recipient,
    base: recipient,
    arbitrum: recipient,
    polygon: recipient
  };

  const response = await fetch('/api/checkouts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      merchantId,
      template: selectedTemplate,
      amountUsd,
      title,
      description,
      orderId: `demo_${selectedTemplate}_${Date.now()}`,
      recipientAddresses,
      acceptedAssets: ['USDC', 'USDT'],
      enabledChains: ['base', 'arbitrum', 'polygon', 'ethereum']
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  }

  persistCheckoutBootstrap(payload);
  window.location.href = payload.checkoutUrl;
}

templateButtons.forEach((button) => {
  button.addEventListener('click', () => setTemplate(button.dataset.template || 'neutral'));
});

titleInput.addEventListener('input', markEdited);
descriptionInput.addEventListener('input', markEdited);
form.addEventListener('submit', (event) => {
  createDemoCheckout(event).catch((error) => {
    statusNode.textContent = error.message;
  });
});

setTemplate(selectedTemplate);
