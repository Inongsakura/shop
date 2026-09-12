'use strict';
class ValidationError extends Error {}
function assert(condition, message) { if (!condition) throw new ValidationError(message); }
function text(value, name, max = 100, optional = false) {
  assert(typeof value === 'string', `${name} ไม่ถูกต้อง`);
  const result = value.trim();
  assert((optional || result.length > 0) && result.length <= max, `กรุณาตรวจสอบ ${name}`);
  return result;
}
function integer(value, name, min, max) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, `${name} ไม่ถูกต้อง`);
  return value;
}
function money(value) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000, 'ราคาไม่ถูกต้อง');
  assert(Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, 'ราคาใช้ทศนิยมได้ไม่เกิน 2 หลัก');
  return Math.round(value * 100);
}
function cartItems(items) {
  assert(Array.isArray(items) && items.length > 0 && items.length <= 20, 'ตะกร้าต้องมี 1–20 รายการ');
  const seen = new Set();
  return items.map(item => {
    const gameId = text(item.gameId, 'รหัสสินค้า', 80);
    assert(/^[a-zA-Z0-9_-]+$/.test(gameId) && !seen.has(gameId), 'รหัสสินค้าซ้ำหรือไม่ถูกต้อง');
    seen.add(gameId);
    return {gameId, qty: integer(item.qty, 'จำนวนสินค้า', 1, 10)};
  });
}
function profile(data) {
  const phone = text(data.phone || '', 'เบอร์โทร', 10, true);
  assert(!phone || /^0\d{9}$/.test(phone), 'เบอร์โทรต้องเป็นเลข 10 หลักและเริ่มด้วย 0');
  return {firstName: text(data.firstName, 'ชื่อ', 80), lastName: text(data.lastName, 'นามสกุล', 80), phone};
}
function quote(items, products, coupon, now = Date.now()) {
  let subtotalCents = 0;
  const lines = items.map(item => {
    const p = products.find(p => p.id === item.gameId);
    assert(p && p.active, 'สินค้าไม่มีจำหน่ายแล้ว');
    assert(p.stock >= item.qty, `สินค้า ${p.name} มีไม่พอ`);
    const unitCents = money(p.salePrice ?? p.price);
    subtotalCents += unitCents * item.qty;
    return {...item, name: p.name, platform: p.platform, unitCents};
  });
  let discountCents = 0;
  if (coupon) {
    assert(coupon.active && (!coupon.expiresAt || coupon.expiresAt > now), 'คูปองหมดอายุหรือปิดใช้งาน');
    assert(coupon.usedCount < coupon.maxUses, 'คูปองถูกใช้ครบแล้ว');
    assert(subtotalCents >= money(coupon.minPurchase), 'ยอดซื้อไม่ถึงขั้นต่ำของคูปอง');
    discountCents = Math.min(subtotalCents, coupon.type === 'percent'
      ? Math.round(subtotalCents * coupon.value / 100) : money(coupon.value));
  }
  return {items: lines, subtotalCents, discountCents, totalCents: subtotalCents - discountCents};
}
function displayOrder(order) {
  if (Number.isSafeInteger(order.totalCents)) return order;
  const total = Number(order.total), timestamp = typeof order.createdAt === 'string' ? Date.parse(order.createdAt) : order.createdAt;
  return {...order, status: 'legacy_demo', totalCents: Number.isFinite(total) ? Math.max(0, Math.round(total*100)) : 0,
    createdAt: Number.isFinite(timestamp) ? timestamp : 0, items: Array.isArray(order.items) ? order.items : []};
}
module.exports = {assert, text, integer, money, cartItems, profile, quote, displayOrder, ValidationError};
