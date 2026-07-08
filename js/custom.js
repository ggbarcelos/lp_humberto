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

// Form submit feedback
document.querySelector('.yellow-form')?.addEventListener('submit', function (e) {
  e.preventDefault();
  const btn = this.querySelector('button[type="submit"]');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Enviando...';
  btn.disabled = true;

  setTimeout(() => {
    btn.innerHTML = 'Cadastro Realizado!';
    btn.style.background = '#28a745';
    this.reset();

    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.background = '';
      btn.disabled = false;
    }, 3000);
  }, 1500);
});