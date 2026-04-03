import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const stripQuotes = (value = "") => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const projectId = stripQuotes(
  process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || ""
);
const clientEmail = stripQuotes(process.env.FIREBASE_ADMIN_CLIENT_EMAIL || "");
const privateKey = stripQuotes(process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(
  /\\n/g,
  "\n"
);

if (!projectId || !clientEmail || !privateKey) {
  throw new Error(
    "Missing Firebase Admin credentials. Define FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY."
  );
}

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });

const auth = getAuth(app);
const db = getFirestore(app);

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "SchoolWays2026!";
const INSTITUTION = {
  code: "L1kj2HG3fd4SA5",
  name: "SchoolWays Demo",
  address: "Cafam La Floresta, Bogota, Colombia",
  lat: 4.68633,
  lng: -74.07406,
};

const ROUTES = [
  {
    id: "ruta-1",
    name: "Ruta 1",
    driver: "Carlos Gomez",
    monitor: "Andrea Rios",
    stops: [
      {
        id: "ruta-1-stop-01",
        title: "Carrera 50a #122 - 90",
        address: "Carrera 50a #122 - 90, Bogota, Colombia",
        coords: { lat: 4.6617291, lng: -74.0783688 },
      },
      {
        id: "ruta-1-stop-02",
        title: "Cafam La Floresta",
        address: "Cafam La Floresta, Bogota, Colombia",
        coords: { lat: 4.68633, lng: -74.07406 },
      },
      {
        id: "ruta-1-stop-03",
        title: "Calle 96 #45a 40",
        address: "Calle 96 #45a 40, Bogota, Colombia",
        coords: { lat: 4.6851812, lng: -74.058837 },
      },
      {
        id: "ruta-1-stop-04",
        title: "Unicentro",
        address: "Unicentro, Bogota, Colombia",
        coords: { lat: 4.7022, lng: -74.0415 },
      },
    ],
  },
  {
    id: "ruta-24",
    name: "Ruta 24 - Suba Norte",
    driver: "Carlos Gomez",
    monitor: "Andrea Rios",
    stops: [
      {
        id: "ruta-24-stop-01",
        title: "Av. Suba #128-80",
        address: "Av. Suba #128-80, Bogota, Colombia",
        coords: { lat: 4.7492477, lng: -74.1011999 },
      },
      {
        id: "ruta-24-stop-02",
        title: "Cra. 72 #127-15",
        address: "Cra. 72 #127-15, Bogota, Colombia",
        coords: { lat: 4.7126058, lng: -74.0776467 },
      },
      {
        id: "ruta-24-stop-03",
        title: "Cl. 116 #58-20",
        address: "Cl. 116 #58-20, Bogota, Colombia",
        coords: { lat: 4.7019522, lng: -74.0820616 },
      },
      {
        id: "ruta-24-stop-04",
        title: "Cl. 109 #54-15",
        address: "Cl. 109 #54-15, Bogota, Colombia",
        coords: { lat: 4.6960113, lng: -74.0531414 },
      },
    ],
  },
  {
    id: "ruta-12",
    name: "Ruta 12 - Usaquen",
    driver: "Mateo Herrera",
    monitor: "Luisa Vargas",
    stops: [
      {
        id: "ruta-12-stop-01",
        title: "Cl. 134 #19-40",
        address: "Cl. 134 #19-40, Bogota, Colombia",
        coords: { lat: 4.7263796, lng: -74.0725173 },
      },
      {
        id: "ruta-12-stop-02",
        title: "Cra. 15 #112-30",
        address: "Cra. 15 #112-30, Bogota, Colombia",
        coords: { lat: 4.7434325, lng: -74.0367267 },
      },
      {
        id: "ruta-12-stop-03",
        title: "Cl. 100 #7-19",
        address: "Cl. 100 #7-19, Bogota, Colombia",
        coords: { lat: 4.6698769, lng: -74.0200815 },
      },
    ],
  },
  {
    id: "ruta-03",
    name: "Ruta 03 - Chapinero",
    driver: "Paula Torres",
    monitor: "Camila Perez",
    stops: [
      {
        id: "ruta-03-stop-01",
        title: "Av. Caracas #63-08",
        address: "Av. Caracas #63-08, Bogota, Colombia",
        coords: { lat: 4.6644905, lng: -74.0608697 },
      },
      {
        id: "ruta-03-stop-02",
        title: "Cl. 57 #11-10",
        address: "Cl. 57 #11-10, Bogota, Colombia",
        coords: { lat: 4.6438865, lng: -74.0640063 },
      },
      {
        id: "ruta-03-stop-03",
        title: "Cl. 45 #13-20",
        address: "Cl. 45 #13-20, Bogota, Colombia",
        coords: { lat: 4.6481856, lng: -74.0911662 },
      },
    ],
  },
];

const MONITOR_USERS = [
  {
    email: "andrea.rios@schoolways.app",
    password: DEFAULT_PASSWORD,
    displayName: "Andrea Rios",
    profile: {
      role: "monitor",
      accountType: "monitor",
      institutionCode: INSTITUTION.code,
      institutionName: INSTITUTION.name,
      institutionAddress: INSTITUTION.address,
      route: "Ruta 24",
    },
  },
  {
    email: "luisa.vargas@schoolways.app",
    password: DEFAULT_PASSWORD,
    displayName: "Luisa Vargas",
    profile: {
      role: "monitor",
      accountType: "monitor",
      institutionCode: INSTITUTION.code,
      institutionName: INSTITUTION.name,
      institutionAddress: INSTITUTION.address,
      route: "Ruta 12",
    },
  },
  {
    email: "camila.perez@schoolways.app",
    password: DEFAULT_PASSWORD,
    displayName: "Camila Perez",
    profile: {
      role: "monitor",
      accountType: "monitor",
      institutionCode: INSTITUTION.code,
      institutionName: INSTITUTION.name,
      institutionAddress: INSTITUTION.address,
      route: "Ruta 03",
    },
  },
];

const STUDENT_CODES = [
  {
    code: "SW24-SOFIA",
    studentName: "Sofia Hernandez",
    institutionCode: INSTITUTION.code,
    institutionName: INSTITUTION.name,
    institutionAddress: INSTITUTION.address,
    institutionLat: INSTITUTION.lat,
    institutionLng: INSTITUTION.lng,
    route: "Ruta 24",
    stopAddress: "Av. Suba #128-80, Bogota, Colombia",
  },
  {
    code: "SW24-TOMAS",
    studentName: "Tomas Rueda",
    institutionCode: INSTITUTION.code,
    institutionName: INSTITUTION.name,
    institutionAddress: INSTITUTION.address,
    institutionLat: INSTITUTION.lat,
    institutionLng: INSTITUTION.lng,
    route: "Ruta 24",
    stopAddress: "Cra. 72 #127-15, Bogota, Colombia",
  },
  {
    code: "SW24-VALE",
    studentName: "Valentina Cruz",
    institutionCode: INSTITUTION.code,
    institutionName: INSTITUTION.name,
    institutionAddress: INSTITUTION.address,
    institutionLat: INSTITUTION.lat,
    institutionLng: INSTITUTION.lng,
    route: "Ruta 24",
    stopAddress: "Cl. 116 #58-20, Bogota, Colombia",
  },
  {
    code: "SW24-NICO",
    studentName: "Nicolas Melo",
    institutionCode: INSTITUTION.code,
    institutionName: INSTITUTION.name,
    institutionAddress: INSTITUTION.address,
    institutionLat: INSTITUTION.lat,
    institutionLng: INSTITUTION.lng,
    route: "Ruta 24",
    stopAddress: "Cl. 109 #54-15, Bogota, Colombia",
  },
];

const STUDENT_USERS = [
  {
    email: "maria@email.com",
    password: DEFAULT_PASSWORD,
    displayName: "Maria Hernandez",
    code: "SW24-SOFIA",
  },
  {
    email: "laura.rueda@schoolways.app",
    password: DEFAULT_PASSWORD,
    displayName: "Laura Rueda",
    code: "SW24-TOMAS",
  },
  {
    email: "jorge.cruz@schoolways.app",
    password: DEFAULT_PASSWORD,
    displayName: "Jorge Cruz",
    code: "SW24-VALE",
  },
  {
    email: "paula.melo@schoolways.app",
    password: DEFAULT_PASSWORD,
    displayName: "Paula Melo",
    code: "SW24-NICO",
  },
];

const studentCodeByCode = Object.fromEntries(STUDENT_CODES.map((item) => [item.code, item]));

const ensureAuthUser = async ({ email, password, displayName }) => {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, {
      email,
      password,
      displayName,
      emailVerified: true,
    });
    return existing.uid;
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const created = await auth.createUser({
    email,
    password,
    displayName,
    emailVerified: true,
  });
  return created.uid;
};

const routeDocument = (route) => ({
  name: route.name,
  route: route.name,
  institutionCode: INSTITUTION.code,
  institutionName: INSTITUTION.name,
  institutionAddress: INSTITUTION.address,
  institutionLat: INSTITUTION.lat,
  institutionLng: INSTITUTION.lng,
  driver: route.driver,
  monitor: route.monitor,
  stops: route.stops.map((stop) => ({
    id: stop.id,
    title: stop.title,
    address: stop.address,
    coords: stop.coords,
  })),
  updatedAt: FieldValue.serverTimestamp(),
});

const setMirroredRouteDocs = async (route) => {
  const payload = routeDocument(route);
  const docTargets = [
    db.collection("routes").doc(route.id),
    db.collection("rutas").doc(route.id),
    db.collection("institutions").doc(INSTITUTION.code).collection("routes").doc(route.id),
    db.collection("institutions").doc(INSTITUTION.code).collection("rutas").doc(route.id),
    db.collection("colegios").doc(INSTITUTION.code).collection("routes").doc(route.id),
    db.collection("colegios").doc(INSTITUTION.code).collection("rutas").doc(route.id),
  ];

  await Promise.all(docTargets.map((ref) => ref.set(payload, { merge: true })));
};

const seedInstitution = async () => {
  const payload = {
    code: INSTITUTION.code,
    name: INSTITUTION.name,
    address: INSTITUTION.address,
    lat: INSTITUTION.lat,
    lng: INSTITUTION.lng,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await Promise.all([
    db.collection("institutions").doc(INSTITUTION.code).set(payload, { merge: true }),
    db.collection("colegios").doc(INSTITUTION.code).set(payload, { merge: true }),
  ]);
};

const seedStudentCodes = async () => {
  await Promise.all(
    STUDENT_CODES.map(async (item) => {
      const payload = {
        ...item,
        updatedAt: FieldValue.serverTimestamp(),
      };
      await Promise.all([
        db.collection("studentCodes").doc(item.code).set(payload, { merge: true }),
        db
          .collection("institutions")
          .doc(INSTITUTION.code)
          .collection("students")
          .doc(item.code)
          .set(payload, { merge: true }),
      ]);
    })
  );
};

const seedMonitorUsers = async () => {
  const created = [];
  for (const item of MONITOR_USERS) {
    const uid = await ensureAuthUser(item);
    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          uid,
          email: item.email,
          displayName: item.displayName,
          fullName: item.displayName,
          lastLogin: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          ...item.profile,
        },
        { merge: true }
      );
    created.push({ email: item.email, password: item.password, role: "monitor" });
  }
  return created;
};

const seedStudentUsers = async () => {
  const created = [];
  for (const item of STUDENT_USERS) {
    const codeData = studentCodeByCode[item.code];
    if (!codeData) {
      throw new Error(`Missing student code seed for ${item.code}`);
    }
    const uid = await ensureAuthUser(item);
    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          uid,
          email: item.email,
          displayName: item.displayName,
          fullName: item.displayName,
          role: "student",
          accountType: "student",
          studentCode: item.code,
          studentName: codeData.studentName,
          institutionCode: codeData.institutionCode,
          institutionName: codeData.institutionName,
          institutionAddress: codeData.institutionAddress,
          institutionLat: codeData.institutionLat,
          institutionLng: codeData.institutionLng,
          route: codeData.route,
          stopAddress: codeData.stopAddress,
          lastLogin: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    await db
      .collection("studentAccounts")
      .doc(item.code)
      .set(
        {
          code: item.code,
          uid,
          email: item.email,
          institutionCode: codeData.institutionCode,
          studentName: codeData.studentName,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    created.push({
      email: item.email,
      password: item.password,
      role: "student",
      studentCode: item.code,
      studentName: codeData.studentName,
    });
  }
  return created;
};

const main = async () => {
  await seedInstitution();
  await Promise.all(ROUTES.map((route) => setMirroredRouteDocs(route)));
  await seedStudentCodes();
  const monitors = await seedMonitorUsers();
  const students = await seedStudentUsers();

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId,
        institution: INSTITUTION,
        defaultPassword: DEFAULT_PASSWORD,
        monitors,
        students,
        studentCodes: STUDENT_CODES.map((item) => ({
          code: item.code,
          studentName: item.studentName,
          route: item.route,
          stopAddress: item.stopAddress,
        })),
        routes: ROUTES.map((route) => ({
          id: route.id,
          name: route.name,
          stops: route.stops.length,
        })),
      },
      null,
      2
    )
  );
};

await main();
