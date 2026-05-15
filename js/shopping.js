// Consolida todos los ingredientes del plan semanal en una lista única
// Retorna un array: [{ productId, name, totalGrams, bestStore, bestPrice, totalCost }]
function generateShoppingList(weeklyPlan, products) {
  const totals = {}; // productId -> gramos totales

  for (const day of weeklyPlan) {
    for (const meal of [day.breakfast, day.lunch, day.dinner]) {
      for (const ing of meal.ingredients) {
        totals[ing.productId] = (totals[ing.productId] ?? 0) + ing.grams;
      }
    }
  }

  const list = [];
  for (const [productId, totalGrams] of Object.entries(totals)) {
    const prod = products.find(p => p.id === productId);
    if (!prod) continue;

    // Encontrar el supermercado más barato
    const entries = Object.entries(prod.prices);
    entries.sort((a, b) => a[1] - b[1]);
    const [bestStore, bestPricePer100g] = entries[0];

    list.push({
      productId,
      name: prod.name,
      totalGrams: Math.round(totalGrams),
      bestStore,
      bestPricePer100g,
      totalCost: Math.round((bestPricePer100g / 100) * totalGrams),
      allPrices: prod.prices,
    });
  }

  // Ordenar por costo total descendente (los más caros primero, para visibilidad)
  list.sort((a, b) => b.totalCost - a.totalCost);
  return list;
}

// Calcula el costo total de la lista comprando todo en un mismo supermercado
function calcTotalByStore(shoppingList, storeName) {
  let total = 0;
  for (const item of shoppingList) {
    const price = item.allPrices[storeName];
    if (price !== undefined) {
      total += (price / 100) * item.totalGrams;
    }
  }
  return Math.round(total);
}

// Genera un resumen de costos por supermercado para mostrar la comparación
function calcStoreComparison(shoppingList, stores) {
  return stores.map(store => ({
    store,
    total: calcTotalByStore(shoppingList, store),
  })).sort((a, b) => a.total - b.total);
}

// Costo total de la lista comprando cada producto en su tienda más barata
function calcOptimalTotal(shoppingList) {
  return shoppingList.reduce((sum, item) => sum + item.totalCost, 0);
}
