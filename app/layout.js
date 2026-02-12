import "./globals.css";
import FooterNav from "./components/FooterNav";

export const metadata = {
  title: "SchoolWays",
  description: "Seguimiento de rutas escolares en tiempo real",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        {children}
        <FooterNav />
      </body>
    </html>
  );
}
