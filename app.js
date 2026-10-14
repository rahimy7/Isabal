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

const form = document.querySelector('#contact-form');
const phone = document.querySelector('#phone');
phone.addEventListener('input', () => phone.setCustomValidity(''));
form.addEventListener('submit', event => {
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
  const message = `Hola, quiero más información sobre las pinturas Isaval en Decolor.\n\nNombre: ${name}\nTeléfono: ${phone.value.trim()}\nCorreo: ${form.elements.email.value.trim()}\n\nMe gustaría recibir asesoría para mi proyecto.`;
  const url = `https://wa.me/18495071438?text=${encodeURIComponent(message)}`;
  document.querySelector('#whatsapp-fallback').href = url;
  document.querySelector('#form-status').hidden = false;
  window.open(url, '_blank', 'noopener,noreferrer');
});
form.elements.name.addEventListener('input', () => form.elements.name.setCustomValidity(''));
