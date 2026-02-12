export async function POST(request) {
  try {
    const body = await request.json();
    const address = body?.address?.toString().trim();
    if (!address) {
      return Response.json({ error: "Address required" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Server key not configured" }, { status: 500 });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("key", apiKey);

    const resp = await fetch(url.toString());
    const data = await resp.json();

    if (data.status !== "OK" || !data.results?.length) {
      return Response.json(
        { error: "Geocoding failed", status: data.status },
        { status: 400 }
      );
    }

    const location = data.results[0].geometry.location;
    return Response.json({
      lat: location.lat,
      lng: location.lng,
      formattedAddress: data.results[0].formatted_address,
    });
  } catch (error) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
