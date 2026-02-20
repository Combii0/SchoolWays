export async function POST(request) {
  try {
    const body = await request.json();
    const points = Array.isArray(body?.points) ? body.points : [];
    const optimizeWaypoints = Boolean(body?.optimizeWaypoints);
    if (points.length < 2) {
      return Response.json({ error: "At least two points required" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Routes API key not configured" }, { status: 500 });
    }

    const normalizePoint = (point) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      return {
        lat,
        lng,
        valid: Number.isFinite(lat) && Number.isFinite(lng),
      };
    };

    const origin = normalizePoint(points[0]);
    const destination = normalizePoint(points[points.length - 1]);
    const intermediates = points.slice(1, -1).map((point) => {
      const normalized = normalizePoint(point);
      if (!normalized.valid) {
        return null;
      }
      return {
        location: { latLng: { latitude: normalized.lat, longitude: normalized.lng } },
      };
    });

    if (!origin.valid || !destination.valid || intermediates.some((point) => !point)) {
      return Response.json({ error: "Invalid coordinates" }, { status: 400 });
    }

    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.optimizedIntermediateWaypointIndex",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: {
            location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
          },
          intermediates,
          optimizeWaypointOrder: optimizeWaypoints && intermediates.length > 1,
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          polylineQuality: "HIGH_QUALITY",
          polylineEncoding: "ENCODED_POLYLINE",
        }),
      }
    );

    const data = await response.json();
    if (!response.ok || !data?.routes?.length) {
      return Response.json(
        { error: "Routes API failed", status: data?.error?.status || null, details: data },
        { status: 400 }
      );
    }

    const route = data.routes[0];
    const legs = Array.isArray(route.legs)
      ? route.legs.map((leg) => ({
          distanceMeters:
            typeof leg?.distanceMeters === "number" ? leg.distanceMeters : null,
          duration: typeof leg?.duration === "string" ? leg.duration : null,
        }))
      : [];
    return Response.json({
      encodedPolyline: route.polyline?.encodedPolyline || null,
      duration: route.duration || null,
      distanceMeters: route.distanceMeters || null,
      legs,
      optimizedIntermediateWaypointIndex: Array.isArray(
        route.optimizedIntermediateWaypointIndex
      )
        ? route.optimizedIntermediateWaypointIndex
        : [],
    });
  } catch (error) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
