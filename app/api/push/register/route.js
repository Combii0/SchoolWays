import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "../../../lib/firebaseAdmin";

export const runtime = "nodejs";

const readBearerToken = (request) => {
  const raw = request.headers.get("authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
};

export async function POST(request) {
  const bearer = readBearerToken(request);
  if (!bearer) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let auth;
  let db;
  try {
    auth = getAdminAuth();
    db = getAdminDb();
  } catch (error) {
    return NextResponse.json(
      { error: "Firebase Admin no configurado" },
      { status: 500 }
    );
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(bearer);
  } catch (error) {
    return NextResponse.json({ error: "Token invalido" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const token =
    typeof body?.token === "string" && body.token.trim() ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "token requerido" }, { status: 400 });
  }

  const userAgent =
    typeof body?.userAgent === "string" && body.userAgent.trim()
      ? body.userAgent.trim()
      : null;

  await db
    .collection("users")
    .doc(decoded.uid)
    .set(
      {
        pushNotifications: {
          web: {
            token,
            tokens: FieldValue.arrayUnion(token),
            enabled: true,
            updatedAt: FieldValue.serverTimestamp(),
            userAgent,
          },
        },
      },
      { merge: true }
    );

  return NextResponse.json({ ok: true }, { status: 200 });
}

