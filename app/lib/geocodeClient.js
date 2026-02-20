const memoryCache = new Map();
const pendingRequests = new Map();

const toQuery = (address) => {
  if (address === null || address === undefined) return "";
  const text = address.toString().trim();
  if (!text) return "";
  if (/colombia/i.test(text)) return text;
  return `${text}, Bogotá, Colombia`;
};

const fromStorage = (query) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`geocode:${query}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch (error) {
    // ignore localStorage parse errors
  }
  return null;
};

const saveStorage = (query, coords) => {
  if (typeof window === "undefined" || !coords) return;
  try {
    window.localStorage.setItem(`geocode:${query}`, JSON.stringify(coords));
  } catch (error) {
    // ignore quota errors
  }
};

export const geocodeAddressToCoords = async (address) => {
  const query = toQuery(address);
  if (!query) return null;

  const memoryHit = memoryCache.get(query);
  if (memoryHit) return memoryHit;

  const storageHit = fromStorage(query);
  if (storageHit) {
    memoryCache.set(query, storageHit);
    return storageHit;
  }

  const pending = pendingRequests.get(query);
  if (pending) return pending;

  const request = fetch("/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: query }),
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      const lat = Number(data?.lat);
      const lng = Number(data?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const coords = { lat, lng };
      memoryCache.set(query, coords);
      saveStorage(query, coords);
      return coords;
    })
    .catch(() => null)
    .finally(() => {
      pendingRequests.delete(query);
    });

  pendingRequests.set(query, request);
  return request;
};
