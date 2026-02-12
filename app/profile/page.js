export default function ProfilePage() {
  return (
    <main className="page">
      <h1>Cuenta y perfil</h1>
      <p style={{ color: "var(--muted)" }}>
        Administra tus datos, estudiantes asignados y preferencias.
      </p>

      <div className="grid two" style={{ marginTop: 20 }}>
        <div className="card glass">
          <h3 style={{ marginTop: 0 }}>Perfil del acudiente</h3>
          <p style={{ color: "var(--muted)" }}>Nombre: Maria Hernandez</p>
          <p style={{ color: "var(--muted)" }}>Tel: +57 312 555 8899</p>
          <p style={{ color: "var(--muted)" }}>Correo: maria@email.com</p>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="button">Editar datos</button>
            <button className="button ghost">Cambiar clave</button>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Estudiante asignado</h3>
          <p style={{ color: "var(--muted)" }}>Nombre: Sofia Hernandez</p>
          <p style={{ color: "var(--muted)" }}>Grado: 4B</p>
          <p style={{ color: "var(--muted)" }}>Ruta asignada: R-24</p>
          <button className="button" style={{ marginTop: 8 }}>
            Ver historial
          </button>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Preferencias</h3>
          <p style={{ color: "var(--muted)" }}>
            Notificaciones: activas
          </p>
          <p style={{ color: "var(--muted)" }}>
            Canal principal: WhatsApp + App
          </p>
          <button className="button secondary" style={{ marginTop: 8 }}>
            Configurar alertas
          </button>
        </div>
        <div className="card glass">
          <h3 style={{ marginTop: 0 }}>Seguridad</h3>
          <p style={{ color: "var(--muted)" }}>Último acceso: Hoy 7:12 a.m.</p>
          <button className="button" style={{ marginTop: 8 }}>
            Revisar accesos
          </button>
        </div>
      </div>
    </main>
  );
}
