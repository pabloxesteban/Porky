/**
 * Porky — Script de actualización de precios e imágenes
 *
 * Fuentes:
 *  - Precios: API de Precios Claros (gobierno argentino)
 *  - Imágenes: Open Food Facts (base de datos pública)
 *
 * Uso:
 *  node scripts/actualizar-precios.js
 *
 * Requiere Node.js 18+ (fetch nativo incluido).
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ===== CONFIGURACIÓN =====

// Coordenadas del centro de Buenos Aires (Plaza de Mayo)
const LAT = -34.6037;
const LNG = -58.3816;

const PC_BASE  = 'https://d3e6htiiul5ek9.cloudfront.net/prod';
const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';

// Multiplicadores por cadena sobre el precio mínimo encontrado
// (estimaciones basadas en posicionamiento de precio de cada cadena en BsAs)
const STORE_MULTIPLIERS = {
  'Día':       1.00,
  'Coto':      1.05,
  'Walmart':   1.08,
  'Carrefour': 1.12,
  'Jumbo':     1.18,
};

// ===== HELPERS =====

// Convierte presentación textual a gramos
// Ej: "500 Gr" → 500, "1 Kg" → 1000, "1 Lt" → 1000
function parsePresentacionGramos(str) {
  if (!str) return null;
  const s = str.replace(',', '.');
  let m;
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo)/i);
  if (m) return parseFloat(m[1]) * 1000;
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|grs|gramos)/i);
  if (m) return parseFloat(m[1]);
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:l|lt|lts|litro|litros)/i);
  if (m) return parseFloat(m[1]) * 1000;
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:ml|cc)/i);
  if (m) return parseFloat(m[1]);
  return null;
}

// Espera N milisegundos (para no sobrecargar las APIs)
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== PRECIOS CLAROS =====

async function buscarEnPreciosClaros(termino) {
  const url = `${PC_BASE}/productos?string=${encodeURIComponent(termino)}&lat=${LAT}&lng=${LNG}&limit=10`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Porky-App/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.productos || [];
  } catch (e) {
    console.error(`  ⚠ Error consultando Precios Claros: ${e.message}`);
    return [];
  }
}

// Calcula el precio real por 100g a partir de los resultados de Precios Claros
// Filtra resultados sin presentación parseable o con precio 0
// Devuelve { pricePer100g, nombre, presentacion, barcode } o null
function calcularPrecioPor100g(resultados) {
  const candidatos = [];

  for (const r of resultados) {
    const gramos = parsePresentacionGramos(r.presentacion);
    if (!gramos || gramos <= 0) continue;
    if (!r.precioMin || r.precioMin <= 0) continue;

    const pricePer100g = Math.round((r.precioMin / gramos) * 100);
    candidatos.push({
      pricePer100g,
      nombre:      r.nombre,
      presentacion: r.presentacion,
      barcode:     r.id,
      precioMin:   r.precioMin,
    });
  }

  if (candidatos.length === 0) return null;

  // Elegir el candidato con precio por 100g más bajo (más económico)
  candidatos.sort((a, b) => a.pricePer100g - b.pricePer100g);
  return candidatos[0];
}

// ===== OPEN FOOD FACTS =====

async function buscarImagenOFF(barcode) {
  if (!barcode) return null;
  try {
    const url = `${OFF_BASE}/${barcode}.json?fields=image_url,image_front_url`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Porky-App/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.product?.image_front_url || data.product?.image_url || null;
  } catch {
    return null;
  }
}

// ===== MAIN =====

async function main() {
  const scriptDir  = dirname(fileURLToPath(import.meta.url));
  const dataPath   = join(scriptDir, '..', 'data', 'products.json');
  const data       = JSON.parse(readFileSync(dataPath, 'utf8'));
  const hoy        = new Date().toISOString().split('T')[0];

  let actualizados = 0;
  let sinDatos     = 0;

  console.log('🐷 Porky — Actualizador de precios e imágenes\n');
  console.log(`📍 Búsqueda en: Buenos Aires (lat ${LAT}, lng ${LNG})`);
  console.log(`📅 Fecha: ${hoy}\n`);
  console.log('─'.repeat(60));

  for (const product of data.products) {
    const termino = product.searchTerm || product.name;
    console.log(`\n🔍 ${product.name} (buscando: "${termino}")`);

    // 1. Buscar en Precios Claros
    const resultados = await buscarEnPreciosClaros(termino);
    await sleep(400);

    if (resultados.length === 0) {
      console.log(`  ⚠ Sin resultados en Precios Claros`);
      sinDatos++;
      continue;
    }

    const mejor = calcularPrecioPor100g(resultados);
    if (!mejor) {
      console.log(`  ⚠ No se pudo calcular precio/100g (presentaciones no parseables)`);
      sinDatos++;
      continue;
    }

    console.log(`  ✓ ${mejor.nombre}`);
    console.log(`    Presentación: ${mejor.presentacion} → $${mejor.precioMin} → $${mejor.pricePer100g}/100g`);

    // 2. Actualizar precios por cadena con multiplicadores
    const precioBase = mejor.pricePer100g;
    for (const [store, mult] of Object.entries(STORE_MULTIPLIERS)) {
      product.prices[store] = Math.round(precioBase * mult);
    }
    product.precioActualizadoEl = hoy;
    product.fuentePrecio = mejor.nombre;

    // 3. Buscar imagen en Open Food Facts (solo si no tiene una ya)
    if (!product.imageUrl && mejor.barcode) {
      console.log(`  🖼  Buscando imagen en Open Food Facts...`);
      const img = await buscarImagenOFF(mejor.barcode);
      await sleep(300);
      if (img) {
        product.imageUrl = img;
        console.log(`  ✓ Imagen encontrada`);
      } else {
        console.log(`  ⚠ Sin imagen en Open Food Facts`);
      }
    }

    actualizados++;
  }

  // Guardar
  writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');

  console.log('\n' + '─'.repeat(60));
  console.log(`✅ Completado: ${actualizados} productos actualizados, ${sinDatos} sin datos.`);
  console.log(`💾 Guardado en: ${dataPath}`);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
