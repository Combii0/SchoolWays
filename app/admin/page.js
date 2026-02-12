const routes = [
  {
    id: "R-24",
    status: "En camino",
    bus: "Bus 24",
    monitor: "Andrea Rios",
    driver: "Carlos Gomez",
  },
  {
    id: "R-12",
    status: "Programada",
    bus: "Bus 12",
    monitor: "Luisa Vargas",
    driver: "Mateo Herrera",
  },
  {
    id: "R-03",
    status: "Finalizada",
    bus: "Bus 03",
    monitor: "Camila Perez",
    driver: "Paula Torres",
  },
];

const alerts = [
  "Ruta 24: 2 estudiantes confirmados a bordo.",
  "Ruta 12: pendiente confirmar paradero 2.",
  "Ruta 03: entrega completada.",
];

export default function AdminPage() {
  return (
    <main className="page">
      <h1>Panel administrativo</h1>
      <p style={{ color: "var(--muted)" }}>
        Control general de rutas, buses y comunicaciones.
      </p>

      <div className="grid two" style={{ marginTop: 20 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Estado de rutas</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Ruta</th>
                <th>Estado</th>
                <th>Bus</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route.id}>
                  <td>{route.id}</td>
                  <td>{route.status}</td>
                  <td>{route.bus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Alertas recientes</h3>
          <div className="notification-list">
            {alerts.map((alert) => (
              <div key={alert} className="notification">
                {alert}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Asignaciones</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Ruta</th>
              <th>Monitora</th>
              <th>Conductor</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <tr key={`${route.id}-people`}>
                <td>{route.id}</td>
                <td>{route.monitor}</td>
                <td>{route.driver}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
