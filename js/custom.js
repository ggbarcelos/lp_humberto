// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// IntersectionObserver for scroll reveal
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('lp-visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.lp-animate-up, .lp-animate-left, .lp-animate-right').forEach(el => {
  observer.observe(el);
});

// ── EmailJS ──
(function () {
  const form = document.querySelector('.yellow-form');
  if (!form) return;

  const SERVICE_ID = 'service_z8vqahp';
  const TEMPLATE_ID = 'template_dh3d49u';
  const PUBLIC_KEY  = 'vRAx-eHsaXBghVQkt';

  emailjs.init(PUBLIC_KEY);

  // Helpers
  function getChecked(name) {
    return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`))
      .map(cb => cb.closest('label')?.textContent?.trim() || cb.value).join('; ') || 'Nenhum';
  }

  function labelText(el) {
    return el?.closest('label')?.textContent?.trim() || el?.value || '';
  }

  // Create / get error message element
  function getErrorEl(field) {
    let el = field.parentNode.querySelector('.form-error-msg');
    if (!el) {
      el = document.createElement('span');
      el.className = 'form-error-msg';
      field.parentNode.appendChild(el);
    }
    return el;
  }

  function clearErrors() {
    form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    form.querySelectorAll('.form-error-msg.is-visible').forEach(el => {
      el.classList.remove('is-visible');
      el.textContent = '';
    });
    form.querySelectorAll('.form-fieldset.is-invalid-legend').forEach(el => el.classList.remove('is-invalid-legend'));
  }

  function showError(field, msg) {
    field.classList.add('is-invalid');
    const err = getErrorEl(field);
    err.textContent = msg;
    err.classList.add('is-visible');
  }

  function markFieldsetInvalid(fieldset) {
    fieldset.classList.add('is-invalid-legend');
    const err = getErrorEl(fieldset.querySelector('legend'));
    err.textContent = 'Selecione uma opção';
    err.classList.add('is-visible');
  }

  function validate() {
    clearErrors();
    let valid = true;

    // Nome
    const nome = form.nome.value.trim();
    if (!nome) { showError(form.nome, 'Informe seu nome'); valid = false; }

    // Email
    const email = form.email.value.trim();
    if (!email) { showError(form.email, 'Informe seu e-mail'); valid = false; }
    else if (!/\S+@\S+\.\S+/.test(email)) { showError(form.email, 'E-mail inválido'); valid = false; }

    // WhatsApp
    const whats = form.whatsapp.value.trim();
    if (!whats) { showError(form.whatsapp, 'Informe seu WhatsApp'); valid = false; }

    // Cidade
    if (!form.cidade.value) { showError(form.cidade, 'Selecione sua cidade'); valid = false; }

    // Integração (radio)
    const integ = form.querySelector('[name="integracao"]:checked');
    if (!integ) { markFieldsetInvalid(form.querySelector('.form-fieldset:nth-of-type(1)')); valid = false; }

    // Colaboração (checkbox - pelo menos 1)
    const colab = form.querySelectorAll('[name="colaboracao"]:checked');
    if (colab.length === 0) { markFieldsetInvalid(form.querySelector('.form-fieldset:nth-of-type(2)')); valid = false; }

    // Bandeiras (checkbox - pelo menos 1)
    const band = form.querySelectorAll('[name="bandeira"]:checked');
    if (band.length === 0) { markFieldsetInvalid(form.querySelector('.form-fieldset:nth-of-type(3)')); valid = false; }

    // WhatsApp lista (radio)
    const wpLista = form.querySelector('[name="whatsapp-lista"]:checked');
    if (!wpLista) { markFieldsetInvalid(form.querySelector('.form-fieldset:nth-of-type(4)')); valid = false; }

    if (!valid) {
      form.querySelector('.is-invalid')?.focus();
    }

    return valid;
  }

  // Success toast
  function showToast() {
    const existing = document.querySelector('.form-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'form-toast';
    toast.innerHTML = `
      <div class="form-toast-icon">
        <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
      </div>
      <div class="form-toast-content">
        <h4>Cadastro enviado!</h4>
        <p>Seus dados foram recebidos. Entraremos em contato em breve.</p>
      </div>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-open'));
    setTimeout(() => {
      toast.classList.remove('is-open');
      setTimeout(() => toast.remove(), 500);
    }, 5000);
  }

  // Submit
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) return;

    const params = {
      form_title: 'Novo cadastro - Pré-campanha Humberto Matos',
      nome:       form.nome.value.trim(),
      email:      form.email.value.trim(),
      whatsapp:   form.whatsapp.value.trim(),
      cidade:     form.cidade.value,
      integracao: labelText(form.querySelector('[name="integracao"]:checked')),
      colaboracao: getChecked('colaboracao'),
      bandeira:   getChecked('bandeira'),
      'whatsapp-lista': labelText(form.querySelector('[name="whatsapp-lista"]:checked')),
      recado:     form.recado.value.trim() || '(sem recado)'
    };

    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.textContent = 'Enviando...';
    btn.disabled = true;

    emailjs.send(SERVICE_ID, TEMPLATE_ID, params)
      .then(() => {
        showToast();
        form.reset();
        clearErrors();
        btn.textContent = 'Cadastro Realizado!';
        btn.style.background = '#28a745';
        setTimeout(() => {
          btn.textContent = original;
          btn.style.background = '';
          btn.disabled = false;
        }, 3000);
      })
      .catch(() => {
        btn.textContent = 'Erro ao enviar';
        btn.style.background = '#dc3545';
        setTimeout(() => {
          btn.textContent = original;
          btn.style.background = '';
          btn.disabled = false;
        }, 3000);
      });
  });
})();
