#!/usr/bin/env node

const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const HELP_TEXT = `
Uso:
  npm run watch:coords -- --route "Ruta 1"
  npm run watch:coords -- --route-id ruta-1
  npm run watch:coords -- --path routes/ruta-1/live/current

Opciones:
  --route       Nombre de ruta (se normaliza a routeId)
  --route-id    ID exacto de la ruta
  --path        Ruta completa del documento Firestore
  --help        Mostrar ayuda
`;

const normalizePrivateKey = (value) => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed.startsWith("'") && trimmed.endsWith("'")
        ? trimmed.slice(1, -1)
        : trimmed;
  return unquoted.replace(/\\n/g, "\n");
};

const getRouteId = (value) => {
  if (!value) return "";
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

const parseArgs = (argv) => {
  const options = {
    help: false,
    route: "",
    routeId: "",
    path: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--route") {
      options.route = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token === "--route-id") {
      options.routeId = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token === "--path") {
      options.path = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (!token.startsWith("-") && !options.routeId && !options.path) {
      options.routeId = token;
    }
  }

  return options;
};

const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatTimestamp = (value) => {
  if (!value) return "-";
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "-";
};

const resolveFirestoreDocPath = (options) => {
  if (options.path) return options.path;
  const directRouteId = options.routeId ? options.routeId.trim() : "";
  const fromRouteName = options.route ? getRouteId(options.route) : "";
  const routeId = directRouteId || fromRouteName;
  if (!routeId) return "";
  return `routes/${routeId}/live/current`;
};

const initFirebaseAdmin = () => {
  if (getApps().length) return getApps()[0];

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "";
  const clientEmail =
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKey = normalizePrivateKey(
    process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || ""
  );

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
  }

  return initializeApp(projectId ? { projectId } : undefined);
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP_TEXT.trim());
    process.exit(0);
  }

  const docPath = resolveFirestoreDocPath(args);
  if (!docPath) {
    console.error(
      "Falta ruta a monitorear. Usa --route, --route-id o --path.\n\n" + HELP_TEXT.trim()
    );
    process.exit(1);
  }

  try {
    initFirebaseAdmin();
  } catch (error) {
    console.error("No se pudo inicializar Firebase Admin:", error?.message || error);
    process.exit(1);
  }

  const db = getFirestore();
  const ref = db.doc(docPath);

  console.log(`[watch:coords] Escuchando ${docPath}`);
  console.log("[watch:coords] Presiona Ctrl+C para terminar.\n");

  const unsubscribe = ref.onSnapshot(
    (snapshot) => {
      const now = new Date().toISOString();
      if (!snapshot.exists) {
        console.log(`[${now}] Documento no existe todavía.`);
        return;
      }

      const data = snapshot.data() || {};
      const lat = toNumber(data.lat ?? data.latitude);
      const lng = toNumber(data.lng ?? data.longitude ?? data.lon ?? data.long);
      const route = data.route || "-";
      const uid = data.uid || "-";
      const updatedAt = formatTimestamp(data.updatedAt);

      if (lat === null || lng === null) {
        console.log(
          `[${now}] Cambio sin coordenadas válidas. route=${route} uid=${uid} updatedAt=${updatedAt}`
        );
        return;
      }

      console.log(
        `[${now}] lat=${lat.toFixed(6)} lng=${lng.toFixed(6)} route=${route} uid=${uid} updatedAt=${updatedAt}`
      );
    },
    (error) => {
      console.error("[watch:coords] Error en listener:", error?.message || error);
    }
  );

  const stop = () => {
    try {
      unsubscribe();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
};

main();
