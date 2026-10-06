/* Fiori Centro de Estética — interações do site (sem dependências). */
(function () {
  'use strict';

  var WHATSAPP = '5548988365189';
  var MAP_SRC = 'https://www.google.com/maps?q=Centro+de+Est%C3%A9tica+Fiori,+Rod.+Armando+Calil+Bulos,+6201,+Ingleses+Norte,+Florian%C3%B3polis&output=embed';
  var startedAt = Date.now();

  document.documentElement.classList.add('js');

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  // ---------- Analytics hook (GA4 / GTM / Meta Pixel podem escutar o dataLayer) ----------
  window.dataLayer = window.dataLayer || [];
  function track(event, data) {
    var payload = { event: event };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
    window.dataLayer.push(payload);
  }

  // ---------- WhatsApp links with a pre-filled message per service ----------
  function waUrl(text) {
    return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(text);
  }
  function waMessage(service) {
    return service
      ? 'Olá, Fiori! Vim pelo site e tenho interesse em ' + service + '. Gostaria de agendar uma avaliação.'
      : 'Olá, Fiori! Vim pelo site e gostaria de agendar uma avaliação.';
  }
  document.querySelectorAll('[data-wa]').forEach(function (link) {
    link.href = waUrl(waMessage(link.getAttribute('data-wa')));
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-track]');
    if (!el) return;
    track('cta_click', {
      cta: el.getAttribute('data-track'),
      service: el.getAttribute('data-wa') || undefined,
    });
  });

  // ---------- Header ----------
  var header = document.querySelector('.site-header');
  var onScroll = function () {
    header.classList.toggle('is-scrolled', window.scrollY > 24);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Mobile menu ----------
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('menu');
  function setMenu(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    nav.classList.toggle('is-open', open);
  }
  toggle.addEventListener('click', function () {
    setMenu(toggle.getAttribute('aria-expanded') !== 'true');
  });
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setMenu(false);
      toggle.focus();
    }
  });

  // ---------- Reveal on scroll ----------
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }

  // ---------- Map: only load Google after the visitor asks (privacy + performance) ----------
  var loadMap = document.getElementById('load-map');
  if (loadMap) {
    loadMap.addEventListener('click', function () {
      var iframe = document.createElement('iframe');
      iframe.src = MAP_SRC;
      iframe.title = 'Mapa: Fiori Centro de Estética em Ingleses, Florianópolis';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer-when-downgrade';
      iframe.setAttribute('allowfullscreen', '');
      var map = document.getElementById('map');
      map.replaceChildren(iframe);
      track('map_loaded');
    });
  }

  // ---------- Lead form ----------
  var form = document.getElementById('lead-form');
  if (!form) return;

  var phoneInput = form.elements.phone;
  var statusEl = document.getElementById('form-status');
  var submitBtn = form.querySelector('[type="submit"]');
  var submitLabel = submitBtn.querySelector('.btn-label');
  var defaultLabel = submitLabel.textContent;

  // Phone mask: (48) 9 9999-9999
  phoneInput.addEventListener('input', function () {
    var d = phoneInput.value.replace(/\D/g, '').slice(0, 11);
    var out = d;
    if (d.length > 2) out = '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length > 7) {
      out = d.length === 11
        ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 3) + ' ' + d.slice(3, 7) + '-' + d.slice(7)
        : '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    }
    phoneInput.value = out;
  });

  // Pre-select the service when the visitor came from a service card.
  var params = new URLSearchParams(window.location.search);
  var preset = params.get('servico');
  if (preset && form.elements.service.querySelector('option[value="' + CSS.escape(preset) + '"]')) {
    form.elements.service.value = preset;
  }

  var labels = {};
  Array.prototype.forEach.call(form.elements.service.options, function (o) { labels[o.value] = o.textContent; });

  function setError(field, message) {
    var input = form.elements[field];
    var el = document.getElementById('e-' + field);
    if (el) el.textContent = message || '';
    if (input && input.setAttribute) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    statusEl.className = 'form-status' + (kind ? ' is-' + kind : '');
  }

  function validate(data) {
    var errors = {};
    if (data.name.length < 2) errors.name = 'Informe seu nome.';
    var digits = data.phone.replace(/\D/g, '');
    if (!/^[1-9]{2}(9\d{8}|[2-5]\d{7})$/.test(digits)) errors.phone = 'Informe um WhatsApp válido com DDD.';
    if (!data.service) errors.service = 'Escolha um tratamento.';
    if (!data.consent) errors.consent = 'É necessário autorizar o contato.';
    return errors;
  }

  function fallbackMessage(data) {
    var periods = { manha: 'manhã', tarde: 'tarde', noite: 'noite', qualquer: 'qualquer horário' };
    var lines = [
      'Olá, Fiori! Meu nome é ' + data.name + '.',
      'Tenho interesse em: ' + (labels[data.service] || 'uma avaliação') + '.',
      'Prefiro atendimento no período: ' + (periods[data.period] || 'qualquer horário') + '.',
    ];
    if (data.message) lines.push('Observação: ' + data.message);
    lines.push('Vim pelo site e gostaria de agendar uma avaliação. 💛');
    return lines.join('\n');
  }

  function openWhatsapp(url) {
    // Same-tab navigation is the most reliable on mobile (pop-up blockers).
    window.location.href = url;
  }

  ['name', 'phone', 'service', 'consent'].forEach(function (field) {
    var input = form.elements[field];
    // Clear errors while typing (not on blur): a layout shift during a tap
    // on the next field would make the tap miss its target.
    input.addEventListener('input', function () { setError(field, ''); });
    input.addEventListener('change', function () { setError(field, ''); });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setStatus('');

    var data = {
      name: form.elements.name.value.trim(),
      phone: phoneInput.value.trim(),
      service: form.elements.service.value,
      period: (form.querySelector('input[name="period"]:checked') || {}).value || 'qualquer',
      message: form.elements.message.value.trim(),
      consent: form.elements.consent.checked,
      website: form.elements.website.value,
      elapsedMs: Date.now() - startedAt,
    };

    var errors = validate(data);
    ['name', 'phone', 'service', 'consent'].forEach(function (f) { setError(f, errors[f]); });
    var firstError = Object.keys(errors)[0];
    if (firstError) {
      form.elements[firstError].focus();
      track('lead_form_invalid', { field: firstError });
      return;
    }

    submitBtn.setAttribute('aria-busy', 'true');
    submitLabel.textContent = 'Enviando...';

    var controller = 'AbortController' in window ? new AbortController() : null;
    var timer = controller && setTimeout(function () { controller.abort(); }, 8000);

    fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(data),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .then(function (r) {
        if (r.status === 422 && r.body.errors) {
          Object.keys(r.body.errors).forEach(function (f) { setError(f, r.body.errors[f]); });
          setStatus('Confira os campos destacados.', 'error');
          return;
        }
        if (r.body && r.body.ok && r.body.whatsappUrl) {
          track('generate_lead', { service: data.service });
          setStatus('Tudo certo! Abrindo o WhatsApp...', 'success');
          openWhatsapp(r.body.whatsappUrl);
          form.reset();
          return;
        }
        throw new Error(r.body && r.body.error ? r.body.error : 'unexpected');
      })
      .catch(function () {
        // If the API is unavailable the visitor must still reach the clinic.
        track('generate_lead', { service: data.service, fallback: true });
        setStatus('Abrindo o WhatsApp...', 'success');
        openWhatsapp(waUrl(fallbackMessage(data)));
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        submitBtn.removeAttribute('aria-busy');
        submitLabel.textContent = defaultLabel;
      });
  });
})();
