const geocodeCache =
  globalThis.__schoolwaysGeocodeCache || (globalThis.__schoolwaysGeocodeCache = new Map());
const geocodeLimiter =
  globalThis.__schoolwaysGeocodeLimiter ||
  (globalThis.__schoolwaysGeocodeLimiter = { chain: Promise.resolve() });

const waitForGeocodeSlot = async () => {
  const previous = geocodeLimiter.chain;
  geocodeLimiter.chain = previous.then(
    () =>
      new Promise((resolve) => {
        setTimeout(resolve, 1100);
      })
  );
  await previous;
};

const buildCacheKey = (address) => address.trim().toLowerCase();

const toResult = (item) => {
  const lat = Number(item?.lat);
  const lng = Number(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    formattedAddress: item?.display_name || "",
  };
};

export async function POST(request) {
  try {
    const body = await request.json();
    const address = body?.address?.toString().trim();
    if (!address) {
      return Response.json({ error: "Address required" }, { status: 400 });
    }

    const cacheKey = buildCacheKey(address);
    const cached = geocodeCache.get(cacheKey);
    if (cached) {
      return Response.json(cached);
    }

    await waitForGeocodeSlot();

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", address);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "co");

    const response = await fetch(url.toString(), {
      headers: {
        "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
        "User-Agent": "SchoolWays/1.0 (Next.js geocoding proxy)",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return Response.json(
        { error: "Geocoding upstream failed", status: response.status },
        { status: 502 }
      );
    }

    const results = await response.json().catch(() => null);
    const firstResult = Array.isArray(results) ? toResult(results[0]) : null;
    if (!firstResult) {
      return Response.json({ error: "Geocoding failed", status: "NO_RESULTS" }, { status: 404 });
    }

    geocodeCache.set(cacheKey, firstResult);
    return Response.json(firstResult);
  } catch (error) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
