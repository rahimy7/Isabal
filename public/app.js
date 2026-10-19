'use strict';
const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#navegacion');
function closeMenu() {
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Abrir menú');
  nav.classList.remove('open');
}
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  nav.classList.toggle('open', open);
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
document.addEventListener('click', event => { if (!event.target.closest('.header')) closeMenu(); });
window.matchMedia('(min-width: 481px)').addEventListener('change', closeMenu);

const panel = document.querySelector('.form-panel');
const form = document.querySelector('#contact-form');
const phone = document.querySelector('#phone');
const store = document.querySelector('#store');
const submitButton = form.querySelector('button[type="submit"]');
const submitLabel = submitButton.querySelector('.button-label');
const formError = document.querySelector('#form-error');
const success = document.querySelector('#form-success');

phone.addEventListener('input', () => phone.setCustomValidity(''));
form.elements.name.addEventListener('input', () => form.elements.name.setCustomValidity(''));
store.addEventListener('invalid', () => store.setCustomValidity(store.value ? '' : 'Elige la tienda más cercana o la que prefieras.'));
store.addEventListener('change', () => store.setCustomValidity(''));

function whatsappUrl(lead) {
  const details = [`Nombre: ${lead.name}`, `Teléfono: ${lead.phone}`, `Tienda de preferencia: ${lead.store}`];
  if (lead.email) details.push(`Correo: ${lead.email}`);
  const message = `Hola, quiero más información sobre las pinturas Isaval en Decolor.\n\n${details.join('\n')}\n\nMe gustaría recibir asesoría para mi proyecto.`;
  return `https://wa.me/18495071438?text=${encodeURIComponent(message)}`;
}

// Guarda la solicitud en el endpoint de data-endpoint (formulario en index.html).
// Mientras esté vacío, el envío se simula: espera un momento y muestra los datos en la consola.
// Con ?simular-error en la URL, la simulación falla, para probar el mensaje de error.
async function saveLead(lead) {
  const endpoint = form.dataset.endpoint;
  if (!endpoint) {
    await new Promise(resolve => setTimeout(resolve, 900));
    if (new URLSearchParams(location.search).has('simular-error')) throw new Error('Error simulado');
    console.info('[Simulación] Solicitud que se guardaría en la base de datos:', lead);
    return;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(lead),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`El endpoint respondió ${response.status}`);
}

function setSending(sending) {
  submitButton.disabled = sending;
  submitButton.classList.toggle('is-loading', sending);
  submitLabel.textContent = sending ? 'Enviando…' : 'Quiero más información';
  form.setAttribute('aria-busy', String(sending));
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const digits = phone.value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    phone.setCustomValidity('Ingresa un teléfono válido, con entre 7 y 15 dígitos.');
    phone.reportValidity();
    return;
  }
  const name = form.elements.name.value.trim();
  if (name.length < 2) {
    form.elements.name.setCustomValidity('Escribe tu nombre completo.');
    form.elements.name.reportValidity();
    return;
  }
  const lead = {
    name,
    phone: phone.value.trim(),
    store: store.value,
    email: form.elements.email.value.trim() || null,
    source: 'landing-isaval-decolor',
    utm: Object.fromEntries([...new URLSearchParams(location.search)].filter(([key]) => key.startsWith('utm_'))),
    createdAt: new Date().toISOString(),
  };

  formError.hidden = true;
  setSending(true);
  try {
    await saveLead(lead);
  } catch (error) {
    console.error('No se pudo guardar la solicitud:', error);
    document.querySelector('#whatsapp-error').href = whatsappUrl(lead);
    formError.hidden = false;
    return;
  } finally {
    setSending(false);
  }

  document.querySelector('#success-name').textContent = name.split(/\s+/)[0];
  document.querySelector('#success-store').textContent = store.value.split(' · ')[0];
  document.querySelector('#whatsapp-success').href = whatsappUrl(lead);
  // Mantiene la altura de la tarjeta para que la página no salte al ocultar el formulario.
  panel.style.minHeight = `${panel.offsetHeight}px`;
  panel.classList.add('is-sent');
  success.hidden = false;
  success.querySelector('h3').focus();
});

document.querySelector('#form-reset').addEventListener('click', () => {
  form.reset();
  success.hidden = true;
  panel.classList.remove('is-sent');
  panel.style.minHeight = '';
  form.elements.name.focus();
});
