const routes = [
  {
    id: "R-24",
    name: "Ruta 24 - Suba Norte",
    status: "En camino",
    driver: "Carlos Gomez",
    monitor: "Andrea Rios",
    stops: [
      "Av. Suba #128-80",
      "Cra. 72 #127-15",
      "Cl. 116 #58-20",
      "Cl. 109 #54-15",
    ],
  },
  {
    id: "R-12",
    name: "Ruta 12 - Usaquen",
    status: "Programada",
    driver: "Mateo Herrera",
    monitor: "Luisa Vargas",
    stops: ["Cl. 134 #19-40", "Cra. 15 #112-30", "Cl. 100 #7-19"],
  },
  {
    id: "R-03",
    name: "Ruta 03 - Chapinero",
    status: "Finalizada",
    driver: "Paula Torres",
    monitor: "Camila Perez",
    stops: ["Av. Caracas #63-08", "Cl. 57 #11-10", "Cl. 45 #13-20"],
  },
];

export default function RoutesPage() {
  return (
    <main className="page">
      <h1>Rutas escolares</h1>
      <p style={{ color: "var(--muted)" }}>
        Consulta las rutas disponibles, sus paraderos y el estado actual.
      </p>
      <div className="grid two" style={{ marginTop: 20 }}>
        {routes.map((route) => (
          <div key={route.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: 0 }}>{route.name}</h3>
                <p style={{ margin: "6px 0", color: "var(--muted)" }}>
                  Conductor: {route.driver}
                </p>
                <p style={{ margin: "6px 0", color: "var(--muted)" }}>
                  Monitora: {route.monitor}
                </p>
              </div>
              <span className="badge">{route.status}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <strong>Paraderos</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {route.stops.map((stop) => (
                  <li key={stop} style={{ marginBottom: 4 }}>
                    {stop}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="button">Ver en mapa</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
