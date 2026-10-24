// Prices and approvals are decided here in code, never by the language model.

export function publicProfile(biz) {
  return {
    name: biz.name,
    owner_name: biz.owner_name,
    city: biz.city,
    capacity: biz.capacity,
    advance_pct: biz.advance_pct,
    faq: biz.faq,
    packages: biz.packages.map(({ floor_per_plate, ...p }) => p),
  };
}

export function checkAvailability(biz, { date, guests }) {
  if (biz.blackout_dates.includes(date)) {
    return { available: false, reason: "That date is already booked." };
  }
  if (guests && guests > biz.capacity) {
    return { available: false, reason: `Capacity is ${biz.capacity} guests.` };
  }
  return { available: true };
}

export function priceQuote(biz, { package_id, guests, requested_price_per_plate }) {
  const pkg = biz.packages.find((p) => p.id === package_id);
  if (!pkg) return { error: `Unknown package. Valid ids: ${biz.packages.map((p) => p.id).join(", ")}` };
  if (!guests || guests < pkg.min_guests) return { error: `Minimum ${pkg.min_guests} guests for ${pkg.name}.` };
  if (guests > biz.capacity) return { error: `Capacity is ${biz.capacity} guests.` };

  const list = pkg.price_per_plate;
  const autoMin = Math.ceil(list * (1 - biz.max_auto_discount_pct / 100));
  const requested = requested_price_per_plate ? Math.round(requested_price_per_plate) : list;
  const perPlate = Math.min(requested, list);

  const needsApproval = perPlate < autoMin;
  const total = perPlate * guests;
  return {
    package: pkg,
    guests,
    list_per_plate: list,
    per_plate: perPlate,
    floor_per_plate: pkg.floor_per_plate,
    total,
    advance: Math.ceil((total * biz.advance_pct) / 100),
    discount_pct: Math.round(((list - perPlate) / list) * 1000) / 10,
    status: needsApproval ? "PENDING_APPROVAL" : "READY",
    below_floor: perPlate < pkg.floor_per_plate,
  };
}

export function withPerPlate(quote, biz, perPlate) {
  const total = perPlate * quote.guests;
  return {
    per_plate: perPlate,
    total,
    advance: Math.ceil((total * biz.advance_pct) / 100),
    discount_pct: Math.round(((quote.list_per_plate - perPlate) / quote.list_per_plate) * 1000) / 10,
  };
}
