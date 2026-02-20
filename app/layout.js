import "./globals.css";
import FooterNav from "./components/FooterNav";
import ForegroundPushIsland from "./components/ForegroundPushIsland";

export const metadata = {
  title: "SchoolWays",
  description: "Seguimiento de rutas escolares en tiempo real",
  applicationName: "SchoolWays",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SchoolWays",
  },
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        {children}
        <ForegroundPushIsland />
        <FooterNav />
      </body>
    </html>
  );
}
