if (window.AOS) {
  AOS.init({
    duration: 800,
    once: true,
    offset: 50,
  });
}

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

async function loadCities() {
  const citySelect = document.getElementById('cidade-select');

  if (!citySelect) {
    return;
  }

  const endpoints = [
    'js/cidades-rs.json',
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados/43/municipios',
  ];

  let cities = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      if (Array.isArray(data) && data.length) {
        cities = data;
        break;
      }
    } catch (error) {
      console.error('Falha ao carregar cidades:', error);
    }
  }

  if (!cities.length) {
    citySelect.innerHTML = '<option value="">Não foi possível carregar as cidades</option>';
    citySelect.disabled = true;
    return;
  }

  const cityNames = cities
    .map(city => city.nome)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  citySelect.innerHTML = '<option value="">Selecione sua cidade</option>';
  cityNames.forEach(cityName => {
    const option = document.createElement('option');
    option.value = cityName;
    option.textContent = cityName;
    citySelect.appendChild(option);
  });
}

loadCities();

function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Enviando...';
  btn.disabled = true;

  setTimeout(() => {
    btn.innerHTML = '<i class="fas fa-check-circle me-2"></i>Cadastro Realizado!';
    btn.style.background = '#28a745';
    form.reset();

    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.background = '';
      btn.disabled = false;
    }, 3000);
  }, 1500);
}
