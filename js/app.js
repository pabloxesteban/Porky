// ===== PERSISTENCIA (localStorage) =====
const STORAGE_KEY = 'porky_plan_v1';

function savePlan() {
  if (!state.goals || !state.weeklyPlan) return;
  const data = { goals: state.goals, weeklyPlan: state.weeklyPlan, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    updateSaveIndicator(data.savedAt);
  } catch { /* storage lleno */ }
}

function loadSavedPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function updateSaveIndicator(isoDate) {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  const d = new Date(isoDate);
  const f = d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
  el.textContent = `✓ Guardado el ${f}`;
  el.removeAttribute('hidden');
}

// Muestra un toast flotante que desaparece en 3s
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ===== ESTADO DE LA APP =====
const state = {
  products: [],
  meals: [],
  stores: [],
  goals: null,
  weeklyPlan: null,
  shoppingList: null,
};

// ===== CARGA DE DATOS =====
async function loadData() {
  const [prodData, mealData] = await Promise.all([
    fetch('data/products.json').then(r => r.json()),
    fetch('data/meals.json').then(r => r.json()),
  ]);
  state.products = prodData.products;
  state.stores   = prodData.stores;
  state.meals    = mealData.meals;
}

// ===== NAVEGACIÓN ENTRE VISTAS =====
const VIEWS = ['setup', 'plan', 'shopping'];

function showView(name) {
  for (const v of VIEWS) {
    const el = document.getElementById(`view-${v}`);
    if (v === name) {
      el.removeAttribute('hidden');
      el.classList.add('active');
    } else {
      el.setAttribute('hidden', '');
      el.classList.remove('active');
    }
  }

  // Actualizar breadcrumb
  document.querySelectorAll('.breadcrumb .step').forEach(step => {
    step.classList.toggle('active', step.dataset.step === name);
  });
}

// ===== FORMATO DE NÚMEROS =====
function formatPesos(amount) {
  return '$' + Math.round(amount).toLocaleString('es-AR');
}

// ===== RENDERIZADO DEL PLAN SEMANAL =====
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MEAL_LABELS = { breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena' };
const MODE_LABELS = {
  extreme:  { icon: '💰', label: 'Ahorro extremo' },
  balanced: { icon: '⚖️', label: 'Híbrido' },
  premium:  { icon: '✨', label: 'Todos los gustos' },
};

function renderPlan() {
  const plan = state.weeklyPlan;
  const goals = state.goals;

  // Resumen en el header
  const avgCal    = Math.round(plan.reduce((s, d) => s + d.totalMacros.calories, 0) / 7);
  const avgProt   = Math.round(plan.reduce((s, d) => s + d.totalMacros.protein,  0) / 7);
  const totalCost = plan.reduce((s, d) => s + d.totalCost, 0);
  // $/g proteína promedio del plan completo
  const totalProt = plan.reduce((s, d) => s + d.totalMacros.protein, 0);
  const costPerProtWeek = totalProt > 0 ? Math.round(totalCost / totalProt) : 0;

  const modeInfo = MODE_LABELS[goals.mode] || MODE_LABELS.balanced;
  const timeLabel = goals.maxPrepTime >= 999 ? 'Sin límite'
    : `≤ ${goals.maxPrepTime} min`;
  document.getElementById('plan-summary').innerHTML =
    `<span class="mode-badge">${modeInfo.icon} ${modeInfo.label}</span>` +
    `<span class="mode-badge">⏱ ${timeLabel}</span>` +
    `<span>${avgCal} kcal · ${avgProt}g prot/día · ${formatPesos(costPerProtWeek)}/g prot</span>`;

  // Grilla de días
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const day = plan[i];
    const col = document.createElement('div');
    col.className = 'day-col';
    col.setAttribute('role', 'listitem');

    col.innerHTML = `<div class="day-label">${DAYS[i]}</div>`;

    for (const type of ['breakfast', 'lunch', 'dinner']) {
      const meal = day[type];
      const macros = calcMealMacros(meal, state.products);
      const cost   = calcMealCost(meal, state.products);
      const costPerProt = calcCostPerProtein(meal, state.products);
      const effLabel = costPerProt < Infinity
        ? `<span class="meal-efficiency">${formatPesos(costPerProt)}/g prot</span>`
        : '';
      const prepLabel = meal.prepTime
        ? `<span class="meal-prep-time">⏱ ${meal.prepTime} min</span>`
        : '';
      const card = document.createElement('div');
      card.className = `meal-card ${type}`;
      card.innerHTML = `
        <div class="meal-type-label">${MEAL_LABELS[type]}</div>
        <span class="meal-emoji">${meal.emoji}</span>
        <div class="meal-name">${meal.name}</div>
        <div class="meal-meta">${prepLabel}</div>
        <div class="meal-macros">${macros.calories} kcal · ${macros.protein}g prot · ${macros.carbs}g CH</div>
        <div class="meal-cost-row">${formatPesos(cost)} ${effLabel}</div>
      `;
      col.appendChild(card);
    }
    grid.appendChild(col);
  }

  // Totales semanales
  const weekCal  = plan.reduce((s, d) => s + d.totalMacros.calories, 0);
  const weekProt = plan.reduce((s, d) => s + d.totalMacros.protein,  0);

  const budgetAlert = totalCost > goals.weeklyBudget
    ? `<span style="color:#ef4444">⚠ Supera presupuesto por ${formatPesos(totalCost - goals.weeklyBudget)}</span>`
    : `<span style="color:#16a34a">✓ Dentro del presupuesto (${formatPesos(goals.weeklyBudget - totalCost)} disponible)</span>`;

  document.getElementById('plan-totals').innerHTML = `
    <div class="totals-group">
      <span class="totals-label">Calorías semana</span>
      <span class="totals-value">${weekCal.toLocaleString('es-AR')} kcal</span>
    </div>
    <div class="totals-group">
      <span class="totals-label">Proteínas semana</span>
      <span class="totals-value">${weekProt}g</span>
    </div>
    <div class="totals-group">
      <span class="totals-label">Costo estimado</span>
      <span class="totals-value green">${formatPesos(totalCost)}</span>
    </div>
    <div class="totals-group">
      <span class="totals-label">Estado</span>
      <span class="totals-value" style="font-size:.95rem">${budgetAlert}</span>
    </div>
  `;
}

// ===== RENDERIZADO DE LISTA DE COMPRAS =====
function renderShopping() {
  const list   = state.shoppingList;
  const stores = state.stores;
  const goals  = state.goals;

  const optimal   = calcOptimalTotal(list);
  const comparison = calcStoreComparison(list, stores);
  const worstTotal = comparison[comparison.length - 1].total;
  const saving     = worstTotal - optimal;

  // Resumen
  document.getElementById('shopping-summary').innerHTML = `
    <div class="summary-item">
      <span class="summary-label">Total optimizado</span>
      <span class="summary-value green">${formatPesos(optimal)}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Tu presupuesto</span>
      <span class="summary-value">${formatPesos(goals.weeklyBudget)}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Ahorrás vs 1 super</span>
      <span class="summary-value green">hasta ${formatPesos(saving)}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Productos</span>
      <span class="summary-value">${list.length}</span>
    </div>
  `;

  // Comparación por supermercado
  const maxTotal = comparison[comparison.length - 1].total;
  document.getElementById('store-comparison').innerHTML = `
    <h3>Costo total si comprás todo en un solo supermercado</h3>
    <div class="store-bars">
      ${comparison.map((s, i) => `
        <div class="store-bar-row">
          <span class="store-bar-name">${s.store}</span>
          <div class="store-bar-track">
            <div class="store-bar-fill ${i === 0 ? 'cheapest' : ''}" style="width:${Math.round((s.total / maxTotal) * 100)}%"></div>
          </div>
          <span class="store-bar-price ${i === 0 ? 'cheapest' : ''}">
            ${formatPesos(s.total)}
            ${i === 0 ? '<span class="store-badge">+ barato</span>' : ''}
          </span>
        </div>
      `).join('')}
    </div>
  `;

  // Tabla de productos
  const tbody = document.getElementById('shopping-tbody');
  tbody.innerHTML = list.map(item => {
    const prod = state.products.find(p => p.id === item.productId);
    const imgHtml = prod?.imageUrl
      ? `<img src="${prod.imageUrl}" class="product-img" alt="${item.name}" loading="lazy" />`
      : `<span class="product-img-placeholder">${prod?.emoji || '🥦'}</span>`;
    const desc = prod?.description
      ? `<span class="product-desc">${prod.description}</span>`
      : '';
    const qty = item.totalGrams >= 1000
      ? (item.totalGrams / 1000).toFixed(1) + ' kg'
      : item.totalGrams + ' g';
    return `
      <tr>
        <td>
          <div class="product-cell">
            ${imgHtml}
            <div class="product-info">
              <span class="product-name">${item.name}</span>
              ${desc}
            </div>
          </div>
        </td>
        <td class="qty-col">${qty}</td>
        <td class="best-col"><span class="badge-best">${item.bestStore}</span>${formatPesos(item.bestPricePer100g)}/100g</td>
        <td class="price-col">${formatPesos(item.totalCost)}</td>
      </tr>
    `;
  }).join('');

  document.getElementById('shopping-tfoot').innerHTML = `
    <tr>
      <td colspan="3">Total comprando cada producto en la tienda más barata</td>
      <td class="price-col">${formatPesos(optimal)}</td>
    </tr>
  `;
}

// ===== FORMULARIO SETUP =====
function readGoals() {
  const calories   = parseInt(document.getElementById('input-calories').value, 10);
  const protein    = parseInt(document.getElementById('input-protein').value,  10);
  const carbs      = parseInt(document.getElementById('input-carbs').value,    10);
  const budget     = parseInt(document.getElementById('input-budget').value,   10);
  const budgetType = document.querySelector('input[name="budget-type"]:checked').value;
  const weeklyBudget = budgetType === 'weekly' ? budget : budget * 7;
  const mode        = document.querySelector('input[name="plan-mode"]:checked')?.value || 'balanced';
  const maxPrepTime = parseInt(document.querySelector('input[name="prep-time"]:checked')?.value || '30', 10);

  return { dailyCalories: calories, dailyProtein: protein, dailyCarbs: carbs, weeklyBudget, mode, maxPrepTime };
}

function validateGoals(goals) {
  if (isNaN(goals.dailyCalories) || goals.dailyCalories < 1000) return 'Las calorías deben ser al menos 1000 kcal.';
  if (isNaN(goals.dailyProtein)  || goals.dailyProtein < 20)   return 'Las proteínas deben ser al menos 20g.';
  if (isNaN(goals.dailyCarbs)    || goals.dailyCarbs < 50)     return 'Los carbohidratos deben ser al menos 50g.';
  if (isNaN(goals.weeklyBudget)  || goals.weeklyBudget < 500)  return 'El presupuesto semanal debe ser al menos $500.';
  return null;
}

// ===== INICIALIZACIÓN Y EVENTOS =====
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();

  // Highlight visual de la mode card seleccionada
  document.querySelectorAll('.mode-card').forEach(card => {
    const radio = card.querySelector('input[type="radio"]');
    card.classList.toggle('selected', radio.checked);
    radio.addEventListener('change', () => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  // Restaurar plan guardado si existe
  const saved = loadSavedPlan();
  if (saved && saved.goals && saved.weeklyPlan) {
    state.goals = saved.goals;
    state.weeklyPlan = saved.weeklyPlan;
    renderPlan();
    updateSaveIndicator(saved.savedAt);
    showView('plan');
    showToast('🐷 Plan restaurado');
  }

  // Actualizar label de unidad presupuesto al cambiar tipo
  document.querySelectorAll('input[name="budget-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const label = document.getElementById('budget-unit-label');
      label.textContent = radio.value === 'weekly' ? 'ARS/semana' : 'ARS/día';
    });
  });

  // Submit del formulario
  document.getElementById('form-setup').addEventListener('submit', e => {
    e.preventDefault();
    const errorEl = document.getElementById('form-error');
    const goals = readGoals();
    const error = validateGoals(goals);

    if (error) {
      errorEl.textContent = error;
      errorEl.removeAttribute('hidden');
      return;
    }
    errorEl.setAttribute('hidden', '');

    state.goals = goals;
    state.weeklyPlan = generateWeeklyPlan(goals, state.meals, state.products);
    renderPlan();
    savePlan();
    showView('plan');
    showToast('🐷 Plan generado y guardado');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Regenerar plan
  document.getElementById('btn-regenerate').addEventListener('click', () => {
    state.weeklyPlan = generateWeeklyPlan(state.goals, state.meals, state.products);
    renderPlan();
    savePlan();
    showToast('🔄 Plan regenerado y guardado');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Ir a lista de compras
  document.getElementById('btn-go-shopping').addEventListener('click', () => {
    state.shoppingList = generateShoppingList(state.weeklyPlan, state.products);
    renderShopping();
    showView('shopping');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Volver al plan
  document.getElementById('btn-back-plan').addEventListener('click', () => {
    showView('plan');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Volver al setup
  document.getElementById('btn-back-setup').addEventListener('click', () => {
    showView('setup');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
