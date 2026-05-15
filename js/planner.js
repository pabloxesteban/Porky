// ===== CONFIGURACIÓN DE MODOS =====
// Cada modo ajusta cómo el algoritmo prioriza costo vs variedad vs macros

const MODES = {
  extreme: {
    proteinWeight: 3.5,  // proteína vale 3.5x — el objetivo es proteína barata
    varietyMax:    3,    // puede repetir la misma comida hasta 3 veces por semana
    budgetFactor:  0.85, // intenta gastar solo el 85% del presupuesto
    poolSize:      1,    // siempre elige la opción #1 (la más eficiente)
  },
  balanced: {
    proteinWeight: 2,    // proteína vale 2x
    varietyMax:    2,    // max 2 veces la misma comida por semana
    budgetFactor:  1.0,
    poolSize:      2,    // elige entre las 2 mejores (algo de variedad)
  },
  premium: {
    proteinWeight: 1.2,  // costo importa menos, variedad importa más
    varietyMax:    1,    // cada comida aparece máximo 1 vez (variedad total)
    budgetFactor:  1.15, // puede usar hasta el 115% del presupuesto diario
    poolSize:      99,   // elige aleatoriamente de todas las opciones elegibles
  },
};

// ===== CÁLCULOS BASE =====

function calcMealMacros(meal, products) {
  const macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ing of meal.ingredients) {
    const prod = products.find(p => p.id === ing.productId);
    if (!prod) continue;
    const ratio = ing.grams / 100;
    macros.calories += prod.macros.calories * ratio;
    macros.protein  += prod.macros.protein  * ratio;
    macros.carbs    += prod.macros.carbs    * ratio;
    macros.fat      += prod.macros.fat      * ratio;
  }
  return {
    calories: Math.round(macros.calories),
    protein:  Math.round(macros.protein),
    carbs:    Math.round(macros.carbs),
    fat:      Math.round(macros.fat),
  };
}

// Costo usando el precio más barato por ingrediente
function calcMealCost(meal, products) {
  let total = 0;
  for (const ing of meal.ingredients) {
    const prod = products.find(p => p.id === ing.productId);
    if (!prod) continue;
    const cheapest = Math.min(...Object.values(prod.prices));
    total += (cheapest / 100) * ing.grams;
  }
  return Math.round(total);
}

// $ por gramo de proteína — métrica clave para veganos
function calcCostPerProtein(meal, products) {
  const macros = calcMealMacros(meal, products);
  const cost   = calcMealCost(meal, products);
  if (macros.protein === 0) return Infinity;
  return Math.round(cost / macros.protein);
}

// ===== SCORE DE EFICIENCIA =====
// "¿Cuánto macro útil obtengo por cada peso que gasto?"
// Mayor score = más eficiente.

function calcEfficiencyScore(meal, goals, products, mealType, mode) {
  const cfg    = MODES[mode] || MODES.balanced;
  const macros = calcMealMacros(meal, products);
  const cost   = calcMealCost(meal, products);
  if (cost === 0) return 0;

  const typeFraction = mealType === 'lunch' ? 0.40 : mealType === 'dinner' ? 0.35 : 0.25;
  const targetCal  = goals.dailyCalories * typeFraction;
  const targetProt = goals.dailyProtein  * typeFraction;
  const targetCarbs = goals.dailyCarbs   * typeFraction;

  // Cobertura de cada macro (limitada a 1.2 para no premiar el exceso)
  const calCov  = Math.min(macros.calories / targetCal,  1.2);
  const protCov = Math.min(macros.protein  / targetProt, 1.2);
  const carbCov = Math.min(macros.carbs    / targetCarbs, 1.2);

  // Score ponderado según el modo
  const weightedValue = (calCov + protCov * cfg.proteinWeight + carbCov) / (2 + cfg.proteinWeight);

  return (weightedValue / cost) * 10000;
}

// ===== SELECTOR DE COMIDA =====

function pickMostEfficientMeal(type, goals, dailyBudget, meals, products, mealUsageCount, mode) {
  const cfg          = MODES[mode] || MODES.balanced;
  const typeFraction = type === 'lunch' ? 0.45 : type === 'dinner' ? 0.35 : 0.20;
  const budgetCap    = dailyBudget * typeFraction * 1.25 * cfg.budgetFactor;

  const maxPrepTime = goals.maxPrepTime || 999;

  const eligible = meals
    .filter(m => m.type === type)
    .filter(m => (m.prepTime || 0) <= maxPrepTime)
    .filter(m => (mealUsageCount[m.id] || 0) < cfg.varietyMax)
    .map(m => ({
      meal:  m,
      score: calcEfficiencyScore(m, goals, products, type, mode),
      cost:  calcMealCost(m, products),
    }))
    .filter(c => c.cost <= budgetCap)
    .sort((a, b) => b.score - a.score);

  if (eligible.length === 0) {
    // Fallback: solo filtrar por tiempo, ignorar variedad y presupuesto
    const fallback = meals
      .filter(m => m.type === type)
      .filter(m => (m.prepTime || 0) <= maxPrepTime)
      .map(m => ({ meal: m, cost: calcMealCost(m, products) }))
      .sort((a, b) => a.cost - b.cost);
    // Si tampoco hay con el tiempo, usar cualquiera
    return (fallback[0] ?? meals.filter(m => m.type === type)
      .map(m => ({ meal: m })))[0]?.meal ?? null;
  }

  // El tamaño del pool determina cuánta aleatoriedad hay en la selección
  const pool = eligible.slice(0, Math.min(cfg.poolSize, eligible.length));
  return pool[Math.floor(Math.random() * pool.length)].meal;
}

// ===== GENERADOR DEL PLAN SEMANAL =====

// goals = { dailyCalories, dailyProtein, dailyCarbs, weeklyBudget, mode }
function generateWeeklyPlan(goals, meals, products) {
  const mode           = goals.mode || 'balanced';
  const dailyBudget    = goals.weeklyBudget / 7;
  const mealUsageCount = {};
  const plan           = [];

  for (let day = 0; day < 7; day++) {
    const breakfast = pickMostEfficientMeal('breakfast', goals, dailyBudget, meals, products, mealUsageCount, mode);
    const lunch     = pickMostEfficientMeal('lunch',     goals, dailyBudget, meals, products, mealUsageCount, mode);
    const dinner    = pickMostEfficientMeal('dinner',    goals, dailyBudget, meals, products, mealUsageCount, mode);

    for (const meal of [breakfast, lunch, dinner]) {
      mealUsageCount[meal.id] = (mealUsageCount[meal.id] || 0) + 1;
    }

    const dayMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    for (const meal of [breakfast, lunch, dinner]) {
      const m = calcMealMacros(meal, products);
      dayMacros.calories += m.calories;
      dayMacros.protein  += m.protein;
      dayMacros.carbs    += m.carbs;
      dayMacros.fat      += m.fat;
    }

    plan.push({
      breakfast,
      lunch,
      dinner,
      totalMacros: dayMacros,
      totalCost: calcMealCost(breakfast, products)
               + calcMealCost(lunch,     products)
               + calcMealCost(dinner,    products),
    });
  }

  return plan;
}
