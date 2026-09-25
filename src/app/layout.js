import "./globals.css";

export const metadata = {
  title: "OptoLabs — 3D Ray Tracing Sandbox",
  description: "Interactive 3D optics simulator with ray tracing, lenses, prisms, mirrors, polarizers, and more. Built with Next.js and Three.js.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
