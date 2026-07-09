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

// Parallax fade on scroll — elements fade & scale as they enter viewport
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

  // ⚠️ Troque pelos seus dados do EmailJS
  const SERVICE_ID = 'service_z8vqahp';
  const TEMPLATE_ID = 'template_dh3d49u';
  const PUBLIC_KEY  = 'vRAx-eHsaXBghVQkt';

  emailjs.init(PUBLIC_KEY);

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // Coleta checkboxes como string separada por "; "
    function getChecked(name) {
      return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`))
        .map(cb => cb.value).join('; ') || 'Nenhum';
    }

    const params = {
      form_title: '📋 Novo cadastro - Pré-campanha Humberto Matos',
      nome:       form.nome.value.trim(),
      email:      form.email.value.trim(),
      whatsapp:   form.whatsapp.value.trim(),
      cidade:     form.cidade.value,
      integracao: form.integracao?.value || '',
      colaboracao: getChecked('colaboracao'),
      bandeira:   getChecked('bandeira'),
      'whatsapp-lista': form.querySelector('[name="whatsapp-lista"]:checked')?.value || '',
      recado:     form.recado.value.trim() || '(sem recado)'
    };

    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.textContent = 'Enviando...';
    btn.disabled = true;

    emailjs.send(SERVICE_ID, TEMPLATE_ID, params)
      .then(() => {
        btn.textContent = 'Cadastro Realizado!';
        btn.style.background = '#28a745';
        form.reset();
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